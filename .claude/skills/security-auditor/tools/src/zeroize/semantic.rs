//! `sec zeroize-semantic`: the trait-aware audit of sensitive types, read from rustdoc JSON (`cargo +nightly rustdoc
//! --document-private-items -- -Z unstable-options --output-format json`): Copy on a secret, no Zeroize/Drop, a Drop
//! that misses fields, heap fields under ZeroizeOnDrop, ManuallyDrop fields, Clone, From/Into escapes, write_bytes
//! without a fence, cfg-gated cleanup, Debug and Serialize, and a crate with no zeroize dependency. Port of
//! semantic_audit.py. It reads today's rustdoc JSON too (see `upgrade`), which the original found nothing in, and
//! where the original would crash (a unit struct's `kind: "unit"`, an attribute that is an object) it reads the
//! value as empty or as its JSON text.
//!
//!   sec zeroize-semantic --rustdoc <path.json> [--cargo-toml <Cargo.toml>] --out <findings.json>
//! exit 0 ran (findings may be empty), 1 rustdoc JSON not found or unparseable, 2 argument error

use super::write_findings;
use crate::obj;
use crate::util::{Args, opt, pad4, py_path, py_repr, py_repr_value, py_str, re_escape, read_text, req, splitlines, truthy};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const SENSITIVE_TYPE: &str = r"(?i)(Key|PrivateKey|SecretKey|SigningKey|MasterKey|HmacKey|Password|Passphrase|Pin|Token|AuthToken|BearerToken|ApiKey|Secret|SharedSecret|PreSharedKey|Nonce|Seed|Entropy|Credential|SessionKey|DerivedKey)";
const SENSITIVE_FIELD: &str = r"(?i)\b(key|secret|password|token|nonce|seed|private|master|credential)\b";

/// evidence tags, for a conservative confidence
const STRONG: &[&str] = &["trait_impl", "resolved_path", "drop_body_source", "cargo_toml"];
const MEDIUM: &[&str] = &["source_scan", "generic_traversal"];
const HEAP_TYPES: &[&str] = &["Vec", "Box", "String", "HashMap", "BTreeMap", "VecDeque", "BinaryHeap", "LinkedList"];

static EMPTY: std::sync::LazyLock<Map<String, Value>> = std::sync::LazyLock::new(Map::new);

/// `x.get(k) or {}`: the object at `k`, or an empty one for anything that is not an object
fn obj_at<'a>(v: &'a Value, k: &str) -> &'a Map<String, Value> {
    v.get(k).and_then(Value::as_object).unwrap_or(&EMPTY)
}
/// `x.get(k) or []`
fn list_at<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
/// `x.get(k) or ""`
fn str_at(v: &Value, k: &str) -> String {
    v.get(k).filter(|x| truthy(Some(x))).map(py_str).unwrap_or_default()
}
/// `((v.get(a) or {}).get(b) or {})...`: the value down a path of objects, None where a step is missing or not an object
fn dig<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().try_fold(v, |at, k| at.as_object()?.get(*k))
}
/// an attribute's text: the string itself, or an object's JSON
fn attr_text(a: &Value) -> String {
    a.as_str().map(String::from).unwrap_or_else(|| a.to_string())
}

struct Audit<'a> {
    index: &'a Map<String, Value>,
    sensitive_type: Regex,
    sensitive_field: Regex,
    counter: usize,
    findings: Vec<Value>,
}

impl<'a> Audit<'a> {
    fn get(&self, id: &Value) -> &'a Value {
        static NULL: Value = Value::Null;
        self.index.get(&py_str(id)).unwrap_or(&NULL)
    }

    #[allow(clippy::too_many_arguments)]
    fn add(&mut self, category: &str, severity: &str, detail: &str, type_name: &str, file: &str, line: &Value, strength: &[&str]) {
        self.counter += 1;
        let strength: Vec<String> = if strength.is_empty() { vec!["heuristic".into()] } else { strength.iter().map(|s| s.to_string()).collect() };
        let strong = strength.iter().filter(|t| STRONG.contains(&t.as_str())).count();
        let medium = strength.iter().filter(|t| MEDIUM.contains(&t.as_str())).count();
        let confidence = if strong >= 2 {
            "confirmed"
        } else if strong == 1 || (medium >= 1 && !strength.iter().any(|t| t == "heuristic")) {
            "likely"
        } else {
            "needs_review"
        };
        self.findings.push(obj! {
            "id" => format!("F-RUST-SRC-{}", pad4(self.counter)),
            "language" => "rust",
            "category" => category,
            "severity" => severity,
            "confidence" => confidence,
            "evidence_strength" => strength.clone(),
            "detail" => detail,
            "symbol" => type_name,
            "object" => obj! { "name" => type_name },
            "location" => obj! { "file" => file, "line" => if truthy(Some(line)) { line.clone() } else { Value::from(1) } },
            "evidence" => vec![obj! { "source" => "rustdoc_json", "detail" => detail, "strength" => strength }],
        });
    }

    fn impls(&self, item: &Value) -> Vec<&'a Value> {
        list_at(item, "impls").iter().map(|id| self.get(id)).collect()
    }

    /// trait names this type implements, by its impl ids
    fn trait_impls(&self, item: &Value) -> HashSet<String> {
        self.impls(item).into_iter().map(|i| trait_name(&impl_trait(i))).filter(|n| !n.is_empty()).collect()
    }

    /// a plain struct's field items (`inner.struct.kind.plain.fields`)
    fn struct_fields(&self, item: &Value) -> Vec<&'a Value> {
        let ids = dig(item, &["inner", "struct", "kind", "plain", "fields"]).and_then(Value::as_array).cloned().unwrap_or_default();
        ids.iter().map(|id| self.get(id)).collect()
    }

    fn has_sensitive_field(&self, fields: &[&Value]) -> bool {
        fields.iter().any(|f| self.sensitive_field.is_match(&str_at(f, "name")))
    }

    fn drop_impls(&self, item: &Value) -> Vec<&'a Value> {
        self.impls(item).into_iter().filter(|i| trait_name(&impl_trait(i)) == "Drop").collect()
    }

    /// zeroed field names and the evidence: the Drop::drop body's source when the span reads, else its docs
    fn zeroed_in_drop(&self, drop_impl: &Value, secret_fields: &[String]) -> (HashSet<String>, Vec<&'static str>) {
        let body = self.drop_body(drop_impl);
        if !body.is_empty() {
            return (zeroed_in_text(&body, secret_fields), vec!["drop_body_source"]);
        }
        let docs = str_at(drop_impl, "docs");
        if !docs.is_empty() {
            return (zeroed_in_text(&docs, secret_fields), vec!["docs_heuristic"]);
        }
        (HashSet::new(), vec!["unavailable"])
    }

    fn drop_body(&self, drop_impl: &Value) -> String {
        let items = dig(drop_impl, &["inner", "impl", "items"]).and_then(Value::as_array).cloned().unwrap_or_default();
        for id in &items {
            let m = self.get(id);
            if str_at(m, "kind") != "function" || str_at(m, "name") != "drop" {
                continue;
            }
            let source = span_source(m);
            if !source.is_empty() {
                return source;
            }
        }
        String::new()
    }

    /// heap field names, or the `__alias_review__` mark when none resolved but the file opens with a heap type alias
    fn heap_fields(&self, fields: &[&Value], source_file: &str) -> Vec<String> {
        let mut heap: Vec<String> = fields.iter().filter(|f| self.named_paths(&field_type(f), &mut HashSet::new()).iter().any(|n| HEAP_TYPES.contains(&n.as_str()))).map(|f| str_at(f, "name")).collect();
        if heap.is_empty() && !source_file.is_empty() {
            match read_text(&span_path(source_file)) {
                // `^` with no multiline flag: only at the start of the file, after any blank lines
                Ok(src) => {
                    if Regex::new(r"^\s*(?:pub\s+)?type\s+\w+\s*=\s*(?:Vec|Box|String|HashMap|BTreeMap)\b").unwrap().is_match(&src) {
                        heap.push("__alias_review__".into());
                    }
                }
                Err(e) => eprintln!("semantic_audit.py: warning: cannot read source for alias scan {}: {e}", py_repr(source_file)),
            }
        }
        heap
    }

    fn manually_drop_fields(&self, fields: &[&Value]) -> Vec<String> {
        fields.iter().filter(|f| self.named_paths(&field_type(f), &mut HashSet::new()).contains("ManuallyDrop")).map(|f| str_at(f, "name")).collect()
    }

    /// From/Into impls whose type argument is not a zeroizing type: ("From<Vec>", evidence)
    fn from_into_escapes(&self, item: &Value) -> Vec<(String, Vec<&'static str>)> {
        let mut out = Vec::new();
        for i in self.impls(item) {
            let tr = impl_trait(i);
            let name = trait_name(&tr);
            if name != "From" && name != "Into" {
                continue;
            }
            let args = dig(&tr, &["args", "angle_bracketed", "args"]).and_then(Value::as_array).cloned().unwrap_or_default();
            for arg in &args {
                let Some(ty) = arg.get("type").filter(|t| t.is_object()) else { continue };
                if self.is_zeroizing(ty) {
                    continue;
                }
                let names: Vec<String> = self.named_paths(ty, &mut HashSet::new()).into_iter().collect();
                let desc = match names.len() {
                    0 => "unknown".to_string(),
                    1 => names[0].clone(),
                    _ => names[..2].join("::"),
                };
                let evidence = if has_resolved_path(ty) { vec!["resolved_path", "generic_traversal"] } else { vec!["alias_heuristic"] };
                out.push((format!("{name}<{desc}>"), evidence));
            }
        }
        out
    }

    fn is_zeroizing(&self, ty: &Value) -> bool {
        let names = self.named_paths(ty, &mut HashSet::new());
        let hint = Regex::new(r"(?i)(Zeroiz|Protected|Secret|Sensitive)").unwrap();
        names.contains("Zeroizing") || names.iter().any(|n| hint.is_match(n))
    }

    /// every path name a type mentions, through references, pointers, arrays, slices, tuples, qualified paths,
    /// generic arguments and type aliases (each alias followed once)
    fn named_paths(&self, ty: &Value, seen: &mut HashSet<String>) -> BTreeSet<String> {
        let mut names = BTreeSet::new();
        if !ty.is_object() {
            return names;
        }
        if let Some(resolved) = ty.get("resolved_path").filter(|r| r.is_object()) {
            if let Some(raw) = resolved.get("name").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                names.insert(raw.rsplit("::").next().unwrap_or(raw).to_string());
            }
            if let Some(id) = resolved.get("id").filter(|i| !i.is_null()) {
                let id_str = py_str(id);
                let alias = self.get(id);
                if !id_str.is_empty() && !seen.contains(&id_str) && alias.is_object() && str_at(alias, "kind") == "typedef" {
                    seen.insert(id_str);
                    let alias_type = alias.get("inner").and_then(|i| i.get("type_alias")).and_then(|t| t.get("type")).filter(|t| truthy(Some(t))).cloned().unwrap_or(Value::Object(Map::new()));
                    names.extend(self.named_paths(&alias_type, seen));
                }
            }
            if let Some(angle) = resolved.get("args").filter(|a| truthy(Some(a))).and_then(|a| a.get("angle_bracketed")).filter(|a| a.is_object()) {
                for arg in list_at(angle, "args") {
                    if let Some(t) = arg.get("type").filter(|t| t.is_object()) {
                        names.extend(self.named_paths(t, seen));
                    }
                }
            }
        }
        for nested in nested_types(ty) {
            names.extend(self.named_paths(nested, seen));
        }
        names
    }

    /// a Drop/Zeroize/ZeroizeOnDrop impl behind #[cfg(feature = ...)]
    fn cfg_feature_on_cleanup(&self, item: &Value) -> bool {
        self.impls(item).into_iter().any(|i| {
            ["Drop", "Zeroize", "ZeroizeOnDrop"].contains(&trait_name(&impl_trait(i)).as_str()) && list_at(i, "attrs").iter().map(attr_text).any(|a| a.contains("cfg") && a.contains("feature"))
        })
    }
}

fn impl_trait(impl_item: &Value) -> Value {
    dig(impl_item, &["inner", "impl", "trait"]).filter(|t| t.is_object()).cloned().unwrap_or(Value::Object(Map::new()))
}

fn trait_name(tr: &Value) -> String {
    let last = |s: &str| s.rsplit("::").next().unwrap_or(s).to_string();
    if let Some(n) = tr.get("name").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        return last(n);
    }
    if let Some(n) = tr.get("resolved_path").and_then(|r| r.get("name")).and_then(Value::as_str).filter(|s| !s.is_empty()) {
        return last(n);
    }
    String::new()
}

fn field_type(field: &Value) -> Value {
    field.get("inner").and_then(|i| i.get("struct_field")).and_then(|s| s.get("type")).filter(|t| truthy(Some(t))).cloned().unwrap_or(Value::Object(Map::new()))
}

fn nested_types(ty: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    for k in ["borrowed_ref", "raw_pointer", "array"] {
        if let Some(t) = ty.get(k).filter(|v| v.is_object()).and_then(|v| v.get("type")).filter(|t| t.is_object()) {
            out.push(t);
        }
    }
    if let Some(s) = ty.get("slice").filter(|v| v.is_object()) {
        out.push(s);
    }
    if let Some(ts) = ty.get("tuple").and_then(Value::as_array) {
        out.extend(ts.iter().filter(|t| t.is_object()));
    }
    if let Some(q) = ty.get("qualified_path").filter(|v| v.is_object()) {
        for k in ["self_type", "trait"] {
            if let Some(t) = q.get(k).filter(|t| t.is_object()) {
                out.push(t);
            }
        }
    }
    out
}

fn has_resolved_path(ty: &Value) -> bool {
    ty.is_object() && (ty.get("resolved_path").is_some() || nested_types(ty).into_iter().any(has_resolved_path))
}

/// the lines of an item's span, read from its file
/// where a span's relative path is looked for when the current folder lacks it: the crate's folder and each folder
/// above it (rustdoc writes the paths relative to the workspace root cargo ran in), then the folders above the rustdoc
/// file. The original read them from the current folder only, so run anywhere else it lost every check that reads source.
static SPAN_BASES: OnceLock<Vec<PathBuf>> = OnceLock::new();

fn span_path(filename: &str) -> PathBuf {
    let p = Path::new(filename);
    if p.is_absolute() || p.exists() {
        return p.to_path_buf();
    }
    SPAN_BASES.get().into_iter().flatten().map(|b| b.join(p)).find(|c| c.is_file()).unwrap_or_else(|| p.to_path_buf())
}

fn span_source(item: &Value) -> String {
    let span = item.get("span").cloned().unwrap_or(Value::Null);
    let filename = span.get("filename").filter(|f| truthy(Some(f))).map(py_str);
    let (begin, end) = (list_at(&span, "begin"), list_at(&span, "end"));
    let (Some(filename), false, false) = (filename, begin.is_empty(), end.is_empty()) else { return String::new() };
    let text = match read_text(&span_path(&filename)) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("semantic_audit.py: warning: cannot read span source {}: {e}", py_repr(&filename));
            return String::new();
        }
    };
    let lines = splitlines(&text);
    let as_int = |v: &Value| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)).unwrap_or(0);
    let start = as_int(&begin[0]).max(1) as usize;
    let end = (as_int(&end[0]).max(start as i64) as usize).min(lines.len());
    if start > lines.len() {
        return String::new();
    }
    lines[start - 1..end].join("\n")
}

/// the source text an item's span covers on its first line (from its begin column to its end, or the line's end)
fn span_text(item: &Value) -> String {
    let span = item.get("span").cloned().unwrap_or(Value::Null);
    let (Some(file), Some(line)) = (span.get("filename").and_then(Value::as_str), dig(&span, &["begin"]).and_then(|b| b.get(0)).and_then(Value::as_u64)) else { return String::new() };
    let Ok(text) = read_text(&span_path(file)) else { return String::new() };
    let Some(l) = splitlines(&text).get((line as usize).saturating_sub(1)).map(|l| l.to_string()) else { return String::new() };
    let col = |k: &str, i: usize| dig(&span, &[k]).and_then(|b| b.get(i)).and_then(Value::as_u64).map(|c| (c as usize).saturating_sub(1));
    let chars: Vec<char> = l.chars().collect();
    let start = col("begin", 1).unwrap_or(0).min(chars.len());
    let end = if dig(&span, &["end"]).and_then(|e| e.get(0)).and_then(Value::as_u64) == Some(line) { col("end", 1).unwrap_or(chars.len()).clamp(start, chars.len()) } else { chars.len() };
    chars[start..end].iter().collect()
}

fn zeroed_in_text(text: &str, fields: &[String]) -> HashSet<String> {
    fields
        .iter()
        .filter(|f| {
            let e = re_escape(f);
            [
                format!(r"\bself\.{e}\.zeroize\s*\("),
                format!(r"\bzeroize\s*\(\s*&mut\s+self\.{e}\s*\)"),
                format!(r"\bself\.{e}\s*=\s*(?:0+|Default::default\(\)|\[[^]]+\])"),
                format!(r"\bself\.{e}\.fill\s*\(\s*0\s*\)"),
            ]
            .iter()
            .any(|p| Regex::new(p).unwrap().is_match(text))
        })
        .cloned()
        .collect()
}

fn write_bytes_without_compiler_fence(source_file: &str) -> bool {
    if source_file.is_empty() {
        return false;
    }
    let Ok(src) = read_text(&span_path(source_file)) else { return false };
    src.contains("write_bytes") && !Regex::new(r"\b(?:core::sync::atomic::|std::sync::atomic::)?compiler_fence\s*\(").unwrap().is_match(&src)
}

/// Some(true/false) when Cargo.toml parsed, None when no path was given or it does not read or parse
fn zeroize_dep(path: Option<&str>) -> Option<bool> {
    let path = path.filter(|p| !p.is_empty())?;
    let content = std::fs::read_to_string(path).ok()?;
    let manifest: toml::Table = match content.parse() {
        Ok(t) => t,
        Err(e) => {
            eprintln!("semantic_audit.py: warning: cannot parse Cargo.toml {}: {}", py_repr(path), e.to_string().trim_end());
            return None;
        }
    };
    let mut tables: Vec<&toml::Table> = Vec::new();
    if let Some(d) = manifest.get("dependencies").and_then(toml::Value::as_table) {
        tables.push(d);
    }
    if let Some(d) = manifest.get("workspace").and_then(toml::Value::as_table).and_then(|w| w.get("dependencies")).and_then(toml::Value::as_table) {
        tables.push(d);
    }
    if let Some(t) = manifest.get("target").and_then(toml::Value::as_table) {
        tables.extend(t.values().filter_map(toml::Value::as_table).filter_map(|t| t.get("dependencies")).filter_map(toml::Value::as_table));
    }
    Some(tables.iter().any(|t| t.iter().any(|(name, spec)| name.to_lowercase() == "zeroize" || spec.get("package").and_then(toml::Value::as_str).is_some_and(|p| p.to_lowercase() == "zeroize"))))
}

/// rustdoc JSON as today's nightly writes it (format 40 and later: no `kind`, impls under `inner.<kind>.impls`,
/// paths named `path`, a field's type directly under `struct_field`, derives only as `automatically_derived` impls)
/// rewritten into the older layout the checks read, which the original alone understood: on today's output it
/// found nothing. Blanket and auto-trait impls are left out (every type has the blanket `Into<U>`), and the Drop
/// that `#[derive(ZeroizeOnDrop)]` writes counts as that derive, not as a hand-written Drop missing its fields.
/// Items that already have a `kind` stay as they are.
fn upgrade(index: &Map<String, Value>) -> Map<String, Value> {
    fn name_paths(v: &mut Value) {
        match v {
            Value::Object(o) => {
                if o.contains_key("id") && !o.contains_key("name") {
                    if let Some(p) = o.get("path").and_then(Value::as_str).map(String::from) {
                        o.insert("name".into(), p.into());
                    }
                }
                o.values_mut().for_each(name_paths);
            }
            Value::Array(a) => a.iter_mut().for_each(name_paths),
            _ => {}
        }
    }
    let kind_of = |item: &Value| -> Option<String> {
        if item.get("kind").is_some() {
            return None;
        }
        let inner = item.get("inner")?.as_object()?;
        (inner.len() == 1).then(|| inner.keys().next().unwrap().clone())
    };
    // paths named first, so the impls looked up below read as the checks will
    let mut named = index.clone();
    for (id, item) in named.iter_mut() {
        if kind_of(&index[id]).is_some() {
            name_paths(item);
        }
    }
    let index = &named;
    let real_impl = |id: &Value| {
        let i = index.get(&py_str(id)).and_then(|i| dig(i, &["inner", "impl"]));
        i.is_some_and(|i| i.get("blanket_impl").is_none_or(Value::is_null) && i.get("is_synthetic") != Some(&Value::Bool(true)))
    };
    let mut out = index.clone();
    for (id, item) in out.iter_mut() {
        let Some(key) = kind_of(&index[id]) else { continue };
        item["kind"] = Value::from(if key == "type_alias" { "typedef" } else { key.as_str() });
        if key == "struct" || key == "enum" {
            let mut impls: Vec<Value> = list_at(&item["inner"][&key], "impls").iter().filter(|i| real_impl(i)).cloned().collect();
            // the Drop that `#[derive(ZeroizeOnDrop)]` writes (its span is that derive) is the derive, not a hand Drop
            let zod_drop = |id: &Value| {
                let i = index.get(&py_str(id)).unwrap_or(&Value::Null);
                trait_name(&impl_trait(i)) == "Drop" && span_text(i).contains("ZeroizeOnDrop")
            };
            let by_derive = impls.iter().any(zod_drop);
            impls.retain(|i| !zod_drop(i));
            let mut derived: Vec<String> = impls
                .iter()
                .filter_map(|i| index.get(&py_str(i)))
                .filter(|i| list_at(i, "attrs").iter().map(attr_text).any(|a| a.contains("automatically_derived")))
                .map(|i| dig(i, &["inner", "impl", "trait", "path"]).map(py_str).unwrap_or_default())
                .filter(|n| !n.is_empty())
                .map(|n| n.rsplit("::").next().unwrap_or(&n).to_string())
                .collect();
            if by_derive {
                derived.push("ZeroizeOnDrop".into());
            }
            item["impls"] = Value::Array(impls);
            if !derived.is_empty() {
                let mut attrs = list_at(item, "attrs").to_vec();
                attrs.push(Value::from(format!("#[derive({})]", derived.join(", "))));
                item["attrs"] = Value::Array(attrs);
            }
        }
        if key == "struct_field" {
            let ty = item["inner"]["struct_field"].take();
            item["inner"]["struct_field"] = obj! { "type" => ty };
        }
    }
    out
}

fn analyze(rustdoc: &Value, cargo_toml: Option<&str>) -> Vec<Value> {
    let upgraded = upgrade(rustdoc.get("index").and_then(Value::as_object).unwrap_or(&EMPTY));
    let index = &upgraded;
    let mut a = Audit { index, sensitive_type: Regex::new(SENSITIVE_TYPE).unwrap(), sensitive_field: Regex::new(SENSITIVE_FIELD).unwrap(), counter: 0, findings: Vec::new() };
    let has_dep = zeroize_dep(cargo_toml);
    let derive = Regex::new(r"derive\(([^)]+)\)").unwrap();
    for item in index.values() {
        let kind = str_at(item, "kind");
        if kind != "struct" && kind != "enum" {
            continue;
        }
        let name = str_at(item, "name");
        if !a.sensitive_type.is_match(&name) {
            let fields = if kind == "struct" { a.struct_fields(item) } else { Vec::new() };
            if !a.has_sensitive_field(&fields) {
                continue;
            }
        }
        let span = Value::Object(obj_at(item, "span").clone());
        let file = str_at(&span, "filename");
        let line = list_at(&span, "begin").first().cloned().unwrap_or(Value::Null);
        let derives: HashSet<String> = list_at(item, "attrs").iter().map(attr_text).filter_map(|t| derive.captures(&t).map(|m| m[1].split(',').map(|d| d.trim().to_string()).collect::<Vec<_>>())).flatten().collect();
        let traits = a.trait_impls(item);
        let is_copy = derives.contains("Copy");

        // 1. Copy on a secret
        if is_copy {
            a.add("SECRET_COPY", "critical", &format!("#[derive(Copy)] on sensitive type '{name}' — all assignments are untracked duplicates, no Drop ever runs"), &name, &file, &line, &["attr_only", "sensitive_name_or_field"]);
        }

        // 2. no Zeroize / ZeroizeOnDrop / Drop (never for Copy, which can't have a Drop)
        let has_zeroize = traits.contains("Zeroize") || traits.contains("ZeroizeOnDrop");
        let has_drop = traits.contains("Drop");
        let has_zod = traits.contains("ZeroizeOnDrop") || derives.contains("ZeroizeOnDrop");
        if !is_copy {
            if !has_zeroize && !has_drop && !has_zod {
                a.add("MISSING_SOURCE_ZEROIZE", "high", &format!("Sensitive type '{name}' has no Zeroize, ZeroizeOnDrop, or Drop implementation"), &name, &file, &line, &["trait_impl", "sensitive_name_or_field"]);
            } else if has_zeroize && !has_zod && !has_drop {
                // implemented, never triggered
                a.add("MISSING_SOURCE_ZEROIZE", "high", &format!("Sensitive type '{name}' implements Zeroize but has no ZeroizeOnDrop or Drop to trigger it automatically"), &name, &file, &line, &["trait_impl", "sensitive_name_or_field"]);
            }
        }

        // 3. a Drop that does not zero every secret field
        if has_drop && kind == "struct" {
            let fields = a.struct_fields(item);
            let secret: Vec<&Value> = fields.iter().copied().filter(|f| a.sensitive_field.is_match(&str_at(f, "name"))).collect();
            let drops = a.drop_impls(item);
            if let (false, Some(drop_impl)) = (secret.is_empty(), drops.first()) {
                let secret_names: Vec<String> = secret.iter().map(|f| str_at(f, "name")).collect();
                let (zeroed, evidence) = a.zeroed_in_drop(drop_impl, &secret_names);
                let unzeroed: Vec<Value> = secret.iter().map(|f| f.get("name").cloned().unwrap_or(Value::Null)).filter(|n| !zeroed.contains(&py_str(n)) || n.is_null()).collect();
                let mut strength = evidence.clone();
                strength.push("trait_impl");
                if !unzeroed.is_empty() {
                    let severity = if evidence.contains(&"drop_body_source") { "high" } else { "medium" };
                    let missing = format!("[{}]", unzeroed.iter().map(py_repr_value).collect::<Vec<_>>().join(", "));
                    a.add("PARTIAL_WIPE", severity, &format!("Drop impl for '{name}' does not zero all secret fields: missing {missing}"), &name, &file, &line, &strength);
                } else if !evidence.contains(&"drop_body_source") {
                    a.add("PARTIAL_WIPE", "medium", &format!("Drop impl for '{name}' found, but field-level zeroization could not be confirmed from function body; review manually"), &name, &file, &line, &strength);
                }
            }
        }

        // 4. ZeroizeOnDrop over heap fields: the capacity past len may stay unwiped
        if has_zod && kind == "struct" {
            let heap = a.heap_fields(&a.struct_fields(item), &file);
            let alias_review = heap.iter().any(|h| h == "__alias_review__");
            let real: Vec<String> = heap.into_iter().filter(|h| h != "__alias_review__").collect();
            if !real.is_empty() {
                a.add("PARTIAL_WIPE", "medium", &format!("ZeroizeOnDrop on '{name}' which has heap fields {} — capacity bytes beyond len may not be zeroed", crate::util::py_repr_list(&real)), &name, &file, &line, &["resolved_path", "generic_traversal", "trait_impl"]);
            } else if alias_review {
                a.add("PARTIAL_WIPE", "medium", &format!("ZeroizeOnDrop on '{name}' — source file contains type aliases that may wrap heap types (Vec/Box/String); verify all heap fields are covered"), &name, &file, &line, &["alias_heuristic", "source_scan", "trait_impl"]);
            }
        }

        // 4b. ManuallyDrop<T> fields
        if kind == "struct" {
            let md = a.manually_drop_fields(&a.struct_fields(item));
            if !md.is_empty() {
                a.add("MISSING_SOURCE_ZEROIZE", "critical", &format!("Sensitive struct '{name}' has ManuallyDrop<T> field(s) {} — Drop does not run automatically on ManuallyDrop fields; secret is not zeroed unless ManuallyDrop::drop() is called explicitly", crate::util::py_repr_list(&md)), &name, &file, &line, &["resolved_path", "trait_impl"]);
            }
        }

        // 5. Clone on a zeroizing type
        if derives.contains("Clone") && (has_zeroize || has_zod || has_drop) {
            a.add("SECRET_COPY", "medium", &format!("Clone on zeroizing type '{name}' — each clone is an independent allocation that must be independently zeroed"), &name, &file, &line, &["attr_only", "trait_impl"]);
        }

        // 6. From/Into into a non-zeroizing type
        for (escape, evidence) in a.from_into_escapes(item) {
            let mut strength = evidence;
            strength.push("trait_impl");
            a.add("SECRET_COPY", "medium", &format!("'{name}' has {escape} conversion returning a non-zeroizing type — bytes escape into caller's ownership in a non-zeroizing container"), &name, &file, &line, &strength);
        }

        // 7. ptr::write_bytes and no compiler_fence in the file
        if write_bytes_without_compiler_fence(&file) {
            a.add("OPTIMIZED_AWAY_ZEROIZE", "medium", &format!("'{name}' is defined in a file that uses ptr::write_bytes without compiler_fence — wipe may be optimized away by the compiler"), &name, &file, &line, &["source_scan", "heuristic"]);
        }

        // 8. cleanup behind a feature flag
        if a.cfg_feature_on_cleanup(item) {
            a.add("NOT_ON_ALL_PATHS", "medium", &format!("#[cfg(feature=...)] wraps Drop or Zeroize impl for '{name}' — zeroing absent when feature flag is off"), &name, &file, &line, &["attr_only", "trait_impl"]);
        }

        // 9, 10. Debug and Serialize copy the secret out
        if derives.contains("Debug") {
            a.add("SECRET_COPY", "low", &format!("#[derive(Debug)] on sensitive type '{name}' — secrets may appear in formatted output / log entries"), &name, &file, &line, &["attr_only"]);
        }
        if derives.contains("Serialize") {
            a.add("SECRET_COPY", "low", &format!("#[derive(Serialize)] on sensitive type '{name}' — serialization creates an uncontrolled copy of secret bytes"), &name, &file, &line, &["attr_only"]);
        }
    }

    // 11. no zeroize crate, only when a Cargo.toml was given and parsed
    if has_dep == Some(false) {
        let path = cargo_toml.filter(|p| !p.is_empty()).unwrap_or("Cargo.toml");
        a.add("MISSING_SOURCE_ZEROIZE", "low", "No 'zeroize' crate in Cargo.toml dependencies — all manual zeroing lacks approved-API guarantee", "<crate>", path, &Value::from(1), &["cargo_toml"]);
    }
    a.findings
}

pub fn main(argv: &[String]) -> i32 {
    let a = Args::parse("sec zeroize-semantic", argv, &[req("rustdoc"), opt("cargo-toml"), req("out")], 0);
    let path = py_path(a.str("rustdoc"));
    if !Path::new(&path).exists() {
        eprintln!("semantic_audit.py: rustdoc JSON not found: {path}");
        return 1;
    }
    let rustdoc: Value = match std::fs::read_to_string(&path).map_err(|e| e.to_string()).and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string())) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("semantic_audit.py: failed to parse rustdoc JSON: {e}");
            return 1;
        }
    };
    let above = |p: &str| -> Vec<PathBuf> { std::fs::canonicalize(p).ok().and_then(|p| p.parent().map(|d| d.ancestors().map(Path::to_path_buf).collect())).unwrap_or_default() };
    let _ = SPAN_BASES.set([a.get("cargo-toml").map(above).unwrap_or_default(), above(&path)].concat());
    let findings = analyze(&rustdoc, a.get("cargo-toml"));
    let out = py_path(a.str("out"));
    if let Err(e) = write_findings(&out, &findings) {
        eprintln!("semantic_audit.py: cannot write {out}: {e}");
        return 1;
    }
    println!("semantic_audit.py: {} finding(s) written to {out}", findings.len());
    0
}
