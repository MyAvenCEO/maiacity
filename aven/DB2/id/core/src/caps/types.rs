//! avenID's built-in types (`Aven.ID.Types`, A39): the root types of the Docs caps makes and of the Records in a
//! Doc's access map. Each id is the name of a fixed label, `avenID <name> 1`, so every reader knows them without
//! fetching anything.

use aven_core::DocId;

/// An avenID built-in type, named by the hash of its label `avenID <name> 1`: Core's [`aven_core::builtin_type`] in
/// avenID's namespace (`builtinType`, A45).
pub fn builtin_type(name: &str) -> DocId {
    aven_core::builtin_type("avenID", name)
}

/// Every built-in type's name (`builtinTypes`).
pub const BUILTIN_TYPES: [&str; 7] = [
    "keyring",
    "safe",
    "group",
    "collection",
    "cap",
    "revoke",
    "epoch",
];

/// The type of a group's Doc: a group that holds a cap is one (A39).
pub fn group_type() -> DocId {
    builtin_type("group")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No two built-in types are one (`builtinTypes.Nodup`), and the group's is the one caps.json's cast gives
    /// `g-garden`.
    #[test]
    fn builtin_types_are_distinct() {
        let ids: Vec<DocId> = BUILTIN_TYPES.iter().map(|n| builtin_type(n)).collect();
        for (i, a) in ids.iter().enumerate() {
            assert!(!ids[i + 1..].contains(a));
        }
        assert!(
            group_type()
                .text()
                .starts_with("d:361c0ac741e58d462e08a50e8fa9155a2bc675845fceca3fe7bc8261f946c1e5")
        );
    }
}
