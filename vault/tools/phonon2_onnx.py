"""Phonon-2 (FermionResearch/Phonon-2) as ONNX, in the layout vault-asr's tdt.rs reads — once, by hand, on
one Mac; the files it writes go into the Models story (vault/app models.rs pins them by BLAKE3).

Phonon-2 is Parakeet TDT 0.6B v3 with its encoder re-trained on English and stored at five values per weight
(fermion-five-value-parakeet-v1). Nothing runs it natively on the Mac but Fermion's MLX engine (Python); so its
weights are expanded (exactly: {0, ±lo, ±hi} per row, int6 tables × their scales, fp16 as stored) and put into
istupakov's ONNX export of the same model (istupakov/parakeet-tdt-0.6b-v3-onnx) — same graph, Phonon's numbers:

  - a Linear's weight → the MatMul that uses it, transposed ([in, out]);
  - the conv module's BatchNorm → folded into its depthwise conv, as the export folded the teacher's;
  - the prediction LSTM's gates → ONNX's order (i, o, f, c from PyTorch's i, f, g, o), its two biases side by side;
  - every other tensor under its NeMo name.

Every initializer of both graphs is written, none left over, every shape checked; and each must stay close to the
teacher's it replaces (Phonon was trained from it — a wrong mapping is not). One tensor at a time: an 8 GB Mac does it.

Then `--int8`: the encoder quantised as istupakov's encoder-model.int8.onnx is (dynamic, int8 weights per channel, its
MatMuls and Convs: 654 MB), and only that kept; and NeMo's preprocessor (nemo128.onnx) copied from the export.

  uv run --with onnx --with onnxruntime --with numpy --with zstandard \\
    vault/tools/phonon2_onnx.py <phonon-2.bps.tar.zst> <istupakov-onnx-dir> <out-dir> --int8

Then its encoder-model.int8.onnx and decoder_joint-model.onnx into <vault>/ingest/models-made/phonon-2/, and the MCP
tool models_import (it checks them against the pins in models.rs). An 8 GB Mac does it in about three minutes.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import tarfile
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper

ARCHIVE_SHA256 = "98125795b6dda72f5c6eee9ba33d19815df65dcb18b50a357bf9f73c9935309e"
CONTAINER = "fermion-five-value-parakeet-v1"
BN_EPS = 1e-5  # NeMo's ConformerConvolution BatchNorm1d


# ---- the container (after FermionResearch/Phonon-2 fermion_container.py, Apache-2.0) ----

def _trits(buf: bytes, o: int, i: int) -> np.ndarray:
    rb = (i + 4) // 5
    x = np.frombuffer(buf, dtype=np.uint8, count=o * rb).reshape(o, rb).astype(np.uint16)
    d = np.empty((o, rb, 5), dtype=np.uint8)
    for k in range(5):
        d[:, :, k] = (x // (3 ** k)) % 3
    return d.reshape(o, rb * 5)[:, :i]


def _five_value(blob: bytes, shape) -> np.ndarray:
    o, i = shape
    rb = (i + 4) // 5
    codes = _trits(blob[: o * rb], o, i)
    nzmask = codes != 1
    nnz = int(nzmask.sum())
    off = o * rb
    bits = np.unpackbits(np.frombuffer(blob[off: off + (nnz + 7) // 8], dtype=np.uint8), bitorder="little")[:nnz].astype(bool)
    off += (nnz + 7) // 8
    lo = np.frombuffer(blob[off: off + 2 * o], dtype=np.float16).astype(np.float32)
    hi = np.frombuffer(blob[off + 2 * o: off + 4 * o], dtype=np.float16).astype(np.float32)
    assert off + 4 * o == len(blob)
    is_hi = np.zeros((o, i), dtype=bool)
    is_hi[nzmask] = bits
    return (codes.astype(np.float32) - 1.0) * np.where(is_hi, hi[:, None], lo[:, None])


def _intn(blob: bytes, shape, bits: int) -> np.ndarray:
    o = shape[0]
    total = int(np.prod(shape))
    body, scales = blob[: -2 * o], np.frombuffer(blob[-2 * o:], dtype=np.float16).astype(np.float32)
    if bits == 8:
        q = np.frombuffer(body, dtype=np.int8).astype(np.int32)[:total]
    elif bits == 6:
        b = np.frombuffer(body, dtype=np.uint8).reshape(-1, 3).astype(np.uint32)
        packed = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        q = np.stack([(packed >> s) & 0x3F for s in (0, 6, 12, 18)], axis=1).ravel()[:total].astype(np.int32) - 32
    else:
        raise ValueError(bits)
    return (q.reshape(o, total // o).astype(np.float32) * scales[:, None]).reshape(shape)


class Phonon:
    """The container's tensors, each expanded to fp32 when asked for, by its HF Transformers (ParakeetForTDT) name —
    a five-value module as `<module>.weight`."""

    def __init__(self, archive: Path):
        import zstandard
        raw = archive.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA256, "not the Phonon-2 archive this was written for"
        with tarfile.open(fileobj=io.BytesIO(zstandard.ZstdDecompressor().decompress(raw, max_output_size=1 << 30))) as t:
            self.data = t.extractfile("model.fermion").read()
        n = int.from_bytes(self.data[:8], "little")
        header = json.loads(self.data[8: 8 + n])
        assert header["format"] == CONTAINER, header["format"]
        self.index, off = {}, 8 + n
        for e in header["index"]:
            name = e["n"] + ".weight" if e["k"] == "five_value" else e["n"]
            self.index[name] = (e["k"], tuple(e["shape"]), off, e["b"])
            off += e["b"]
        assert off == len(self.data), "trailing bytes"

    def __getitem__(self, name: str) -> np.ndarray:
        k, shape, off, b = self.index[name]
        blob = self.data[off: off + b]
        if k == "five_value":
            return _five_value(blob, shape)
        if k.startswith("int"):
            return _intn(blob, shape, int(k[3:]))
        assert k == "fp16", k
        return np.frombuffer(blob, dtype=np.float16).reshape(shape).astype(np.float32)

    def layers(self) -> int:
        return 1 + max(int(n.split(".")[2]) for n in self.index if n.startswith("encoder.layers."))


# ---- Phonon's tensors under the export's names (each a thunk: made when written) ----

def _lstm_gates(w: np.ndarray) -> np.ndarray:
    i, f, g, o = np.split(w, 4, axis=0)
    return np.concatenate([i, o, f, g], axis=0)


def encoder_tensors(p: Phonon, graph: onnx.GraphProto) -> dict:
    out = {}
    for k in (0, 2, 3, 5, 6):
        for t in ("weight", "bias"):
            out[f"pre_encode.conv.{k}.{t}"] = lambda n=f"encoder.subsampling.layers.{k}.{t}": p[n]
    out["pre_encode.out.bias"] = lambda: p["encoder.subsampling.linear.bias"]
    for l in range(p.layers()):
        e = f"encoder.layers.{l}"
        for norm in ("norm_feed_forward1", "norm_self_att", "norm_conv", "norm_feed_forward2", "norm_out"):
            for t in ("weight", "bias"):
                out[f"layers.{l}.{norm}.{t}"] = lambda n=f"{e}.{norm}.{t}": p[n]
        out[f"layers.{l}.self_attn.pos_bias_u"] = lambda n=f"{e}.self_attn.bias_u": p[n]
        out[f"layers.{l}.self_attn.pos_bias_v"] = lambda n=f"{e}.self_attn.bias_v": p[n]
        for pw in ("pointwise_conv1", "pointwise_conv2"):
            out[f"layers.{l}.conv.{pw}.weight"] = lambda n=f"{e}.conv.{pw}.weight": p[n][:, :, None]
    # the anonymous initializers, by the node that uses them
    linear = {"feed_forward1/linear1": "feed_forward1.linear1", "feed_forward1/linear2": "feed_forward1.linear2",
              "self_attn/linear_q": "self_attn.q_proj", "self_attn/linear_k": "self_attn.k_proj",
              "self_attn/linear_v": "self_attn.v_proj", "self_attn/linear_pos": "self_attn.relative_k_proj",
              "self_attn/linear_out": "self_attn.o_proj", "feed_forward2/linear1": "feed_forward2.linear1",
              "feed_forward2/linear2": "feed_forward2.linear2"}

    def bn_scale(c: str) -> np.ndarray:
        return p[f"{c}.norm.weight"] / np.sqrt(p[f"{c}.norm.running_var"] + BN_EPS)

    for node in graph.node:
        parts = node.name.strip("/").split("/")
        if node.op_type == "MatMul" and node.name == "/pre_encode/out/MatMul":
            out[node.input[1]] = lambda: p["encoder.subsampling.linear.weight"].T
        elif node.op_type == "MatMul" and parts[0].startswith("layers.") and "/".join(parts[1:3]) in linear:
            out[node.input[1]] = lambda n=f"encoder.{parts[0]}.{linear['/'.join(parts[1:3])]}.weight": p[n].T
        elif node.op_type == "Conv" and node.name.endswith("/conv/depthwise_conv/Conv"):
            c = f"encoder.{parts[0]}.conv"
            out[node.input[1]] = lambda c=c: p[f"{c}.depthwise_conv.weight"] * bn_scale(c)[:, None, None]
            out[node.input[2]] = lambda c=c: p[f"{c}.norm.bias"] - p[f"{c}.norm.running_mean"] * bn_scale(c)
    return out


def decoder_tensors(p: Phonon, graph: onnx.GraphProto) -> dict:
    out = {
        "decoder.prediction.embed.weight": lambda: p["decoder.embedding.weight"],
        "joint.enc.bias": lambda: p["encoder_projector.bias"],
        "joint.pred.bias": lambda: p["decoder.decoder_projector.bias"],
        "joint.joint_net.2.bias": lambda: p["joint.head.bias"],
    }
    matmul = {"/joint/enc/MatMul": "encoder_projector.weight", "/joint/pred/MatMul": "decoder.decoder_projector.weight",
              "/joint/joint_net/joint_net.2/MatMul": "joint.head.weight"}
    lstm = {"/decoder/dec_rnn/lstm/LSTM": 0, "/decoder/dec_rnn/lstm/LSTM_1": 1}
    for node in graph.node:
        if node.op_type == "MatMul" and node.name in matmul:
            out[node.input[1]] = lambda n=matmul[node.name]: p[n].T
        elif node.op_type == "LSTM" and node.name in lstm:
            l = lstm[node.name]
            out[node.input[1]] = lambda l=l: _lstm_gates(p[f"decoder.lstm.weight_ih_l{l}"])[None]
            out[node.input[2]] = lambda l=l: _lstm_gates(p[f"decoder.lstm.weight_hh_l{l}"])[None]
            out[node.input[3]] = lambda l=l: np.concatenate([_lstm_gates(p[f"decoder.lstm.bias_ih_l{l}"]), _lstm_gates(p[f"decoder.lstm.bias_hh_l{l}"])])[None]
    return out


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a.ravel().astype(np.float64), b.ravel().astype(np.float64)
    return 1.0 if a.size < 2 or np.std(a) == 0 else float(np.corrcoef(a, b)[0, 1])


def swap(src: Path, dst: Path, make, p: Phonon) -> list[tuple[str, float]]:
    """The export at `src` with Phonon's numbers, written to `dst` — its external data (if it has any) streamed, one
    tensor at a time, into `<dst>.data`. Returns each tensor's correlation with the teacher's."""
    model = onnx.load(str(src), load_external_data=False)
    new = make(p, model.graph)
    names = [i.name for i in model.graph.initializer]
    assert set(new) == set(names), f"unmapped: {sorted(set(names) - set(new))[:5]} unknown: {sorted(set(new) - set(names))[:5]}"
    corr, data, offset = [], None, 0
    for init in model.graph.initializer:
        ext = {e.key: e.value for e in init.external_data}
        if ext:
            n = np.dtype(np.float32).itemsize * int(np.prod(init.dims))
            old = np.fromfile(src.parent / ext["location"], dtype=np.float32, count=n // 4, offset=int(ext.get("offset", 0))).reshape(tuple(init.dims))
        else:
            old = numpy_helper.to_array(init)
        w = np.ascontiguousarray(new[init.name](), dtype=np.float32)
        assert w.shape == old.shape, (init.name, w.shape, old.shape)
        corr.append((init.name, _corr(old, w)))
        if ext:
            if data is None:
                data = open(dst.parent / (dst.name + ".data"), "wb")
            raw = w.tobytes()
            data.write(raw)
            del init.external_data[:]
            for k, v in (("location", dst.name + ".data"), ("offset", str(offset)), ("length", str(len(raw)))):
                e = init.external_data.add()
                e.key, e.value = k, v
            offset += len(raw)
        else:
            init.CopyFrom(numpy_helper.from_array(w, init.name))
    if data is not None:
        data.close()
    onnx.save_model(model, str(dst))
    return corr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path, help="phonon-2.bps.tar.zst")
    ap.add_argument("export", type=Path, help="istupakov/parakeet-tdt-0.6b-v3-onnx (encoder-model.onnx + .data, decoder_joint-model.onnx, vocab.txt, nemo128.onnx)")
    ap.add_argument("out", type=Path)
    ap.add_argument("--int8", action="store_true", help="the encoder in int8 (encoder-model.int8.onnx), and only that kept")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    p = Phonon(a.archive)
    print(f"Phonon-2: {len(p.index)} tensors, {p.layers()} encoder layers", file=sys.stderr)
    corr = swap(a.export / "decoder_joint-model.onnx", a.out / "decoder_joint-model.onnx", decoder_tensors, p)
    corr += swap(a.export / "encoder-model.onnx", a.out / "encoder-model.onnx", encoder_tensors, p)
    for f in ("vocab.txt", "nemo128.onnx"):
        shutil.copy(a.export / f, a.out / f)
    worst = sorted(corr, key=lambda x: x[1])[:6]
    print(f"{len(corr)} tensors; least like the teacher's: " + ", ".join(f"{n} {c:.3f}" for n, c in worst), file=sys.stderr)
    assert worst[0][1] > 0.5, "a tensor unlike the teacher's: the mapping is wrong"
    if a.int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(a.out / "encoder-model.onnx", a.out / "encoder-model.int8.onnx", weight_type=QuantType.QInt8, per_channel=True, op_types_to_quantize=["MatMul", "Conv"])
        (a.out / "encoder-model.onnx").unlink()
        (a.out / "encoder-model.onnx.data").unlink()
    for f in sorted(a.out.iterdir()):
        print(f"{f.stat().st_size:>14,}  {f.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
