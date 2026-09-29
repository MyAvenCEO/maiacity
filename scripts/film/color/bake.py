# The render-time LUT baker. The pipeline's colour transforms are configs (game/film/transforms.js); the render worker
# calls this while it renders to turn one config into a LUT file, which it caches on its own disk by a hash of the
# config, the OCIO version and the size. Nothing baked here is committed or kept in the repo.
#
#   python3 scripts/film/color/bake.py --version
#       the OpenColorIO version (part of every cache key)
#   python3 scripts/film/color/bake.py --config '<json>' --size 65 --format cube --out <file>
#       a 3D LUT for ffmpeg's lut3d (.cube, red fastest)
#   python3 scripts/film/color/bake.py --config '<json>' --size 65536 --format cube1d --out <file>
#       a 1D LUT for ffmpeg's lut1d, over 0…1 (only for a per-channel curve, e.g. one builtin CURVE step)
#   python3 scripts/film/color/bake.py --config '<json>' --size 65 --format mlut --out <file> [--name n --hash h]
#       a preview LUT for the studio's viewer (the MLUT1 format documented in game/film/transforms.js)
#   python3 scripts/film/color/bake.py --config '<json>' --apply  < rgb.f32 > out.f32
#       the exact transform (no LUT) on float32 RGB triples: the reference the tests measure ffmpeg against
#   python3 scripts/film/color/bake.py --config '<json>' --size 65 --check
#       how far a LUT of that size is from OCIO itself (10-bit code values)
#
# Config kinds: 'ocio-view' (display/view, forward or inverse), 'ocio-convert' (src → dst colour space),
# 'ocio-group' (builtin curves, matrices and conversions chained), 'cdl' (the ASC CDL of color.js) and 'chain'
# (several of these one after the other, baked into one LUT). 'identity' and 'math' configs are exact maths the
# worker does with ffmpeg filters; they are not baked here.
#
# Needs OpenColorIO ≥ 2.5 and numpy (pip install opencolorio numpy).
import sys, os, gzip, json, struct, argparse
import numpy as np
import PyOpenColorIO as ocio


LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)


class Cdl:
    # the ASC CDL in ACEScct, exactly as cdl() in game/film/color.js: slope, offset, power per channel (held at 0
    # before a power), then saturation around Rec.709 luma
    def __init__(self, g):
        self.slope, self.offset, self.power = (np.array(g[k], dtype=np.float64) for k in ('slope', 'offset', 'power'))
        self.sat = float(g['sat'])

    def applyRGB(self, rgb):
        v = rgb.astype(np.float64) * self.slope + self.offset
        v = np.where(self.power == 1, v, np.power(np.maximum(v, 0), self.power))
        l = (v @ LUMA)[:, None]
        rgb[...] = (l + self.sat * (v - l)).astype(np.float32)


class Chain:
    def __init__(self, steps):
        self.steps = [processor(s) for s in steps]

    def applyRGB(self, rgb):
        for p in self.steps:
            p.applyRGB(rgb)


def processor(conf):
    kind = conf['kind']
    if kind == 'cdl':
        return Cdl(conf['cdl'])
    if kind == 'chain':
        return Chain(conf['steps'])
    cfg = ocio.Config.CreateFromBuiltinConfig(conf['config'])
    if kind == 'ocio-view':
        d = ocio.TRANSFORM_DIR_FORWARD if conf['direction'] == 'forward' else ocio.TRANSFORM_DIR_INVERSE
        t = ocio.DisplayViewTransform(src=conf['colorspace'], display=conf['display'], view=conf['view'], direction=d)
        return cfg.getProcessor(t).getDefaultCPUProcessor()
    if kind == 'ocio-convert':
        return cfg.getProcessor(conf['src'], conf['dst']).getDefaultCPUProcessor()
    if kind == 'ocio-group':
        steps = []
        for s in conf['steps']:
            if 'builtin' in s:
                steps.append(ocio.BuiltinTransform(s['builtin']))
            elif 'matrix' in s:
                m = s['matrix']
                steps.append(ocio.MatrixTransform(matrix=[*m[0], 0, *m[1], 0, *m[2], 0, 0, 0, 0, 1]))
            elif 'convert' in s:
                steps.append(ocio.ColorSpaceTransform(src=s['convert'][0], dst=s['convert'][1]))
            else:
                raise SystemExit(f'unknown step {s}')
        return cfg.getProcessor(ocio.GroupTransform(steps)).getDefaultCPUProcessor()
    raise SystemExit(f"a '{kind}' transform is exact maths: the worker does it with ffmpeg filters, nothing to bake")


def grid(n):
    v = np.linspace(0.0, 1.0, n, dtype=np.float32)
    # .cube order: red changes fastest, then green, then blue
    b, g, r = np.meshgrid(v, v, v, indexing='ij')
    return np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1).astype(np.float32)


def apply(proc, rgb):
    out = np.ascontiguousarray(rgb, dtype=np.float32).copy()
    proc.applyRGB(out)
    return out.reshape(-1, 3)


def table(proc, n):
    rgb = apply(proc, grid(n))
    return np.nan_to_num(rgb, nan=0.0, posinf=65504.0, neginf=-65504.0)


def write_cube(path, rgb, n, title):
    with open(path + '.part', 'w') as f:
        f.write(f'TITLE "{title}"\nLUT_3D_SIZE {n}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        np.savetxt(f, rgb, fmt='%.8g')
    os.replace(path + '.part', path)


def write_mlut(path, rgb, n, head):
    lo, hi = float(rgb.min()), float(rgb.max())
    u = np.round((rgb - lo) / (hi - lo) * 65535).astype('<u2')
    h = json.dumps({**head, 'size': n, 'min': lo, 'max': hi}).encode()
    # mtime 0: the same numbers always give the same bytes, and so the same CID
    with open(path + '.part', 'wb') as f, gzip.GzipFile(fileobj=f, mode='wb', mtime=0, filename='') as z:
        z.write(b'MLUT1' + struct.pack('<I', len(h)) + h + u.tobytes())
    os.replace(path + '.part', path)


def tetra(lut, n, p):
    # tetrahedral interpolation, as ffmpeg's lut3d (interp=tetrahedral) and the studio's shader do
    x = np.clip(p, 0, 1) * (n - 1)
    i = np.minimum(np.floor(x).astype(int), n - 2)
    f = x - i
    L = lut.reshape(n, n, n, 3)  # [b][g][r]

    def at(dr, dg, db):
        return L[i[:, 2] + db, i[:, 1] + dg, i[:, 0] + dr]

    fr, fg, fb = f[:, 0:1], f[:, 1:2], f[:, 2:3]
    c000, c111 = at(0, 0, 0), at(1, 1, 1)
    out = np.zeros_like(p)
    conds = [(fr >= fg) & (fg >= fb), (fr >= fb) & (fb > fg), (fb > fr) & (fr >= fg),
             (fg > fr) & (fr >= fb), (fg >= fb) & (fb > fr), (fb > fg) & (fg > fr)]
    steps = [((1, 0, 0), (1, 1, 0)), ((1, 0, 0), (1, 0, 1)), ((0, 0, 1), (1, 0, 1)),
             ((0, 1, 0), (1, 1, 0)), ((0, 1, 0), (0, 1, 1)), ((0, 0, 1), (0, 1, 1))]
    weights = [(fr, fg, fb), (fr, fb, fg), (fb, fr, fg), (fg, fr, fb), (fg, fb, fr), (fb, fg, fr)]
    for c, (s1, s2), (w1, w2, w3) in zip(conds, steps, weights):
        v = (1 - w1) * c000 + (w1 - w2) * at(*s1) + (w2 - w3) * at(*s2) + w3 * c111
        out = np.where(c, v, out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', action='store_true')
    ap.add_argument('--config')
    ap.add_argument('--size', type=int, default=65)
    ap.add_argument('--format', choices=['cube', 'cube1d', 'mlut'], default='cube')
    ap.add_argument('--out')
    ap.add_argument('--name', default='')
    ap.add_argument('--hash', default='')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.version:
        print(ocio.__version__)
        return
    if not a.config:
        raise SystemExit('give --config (a transform config from game/film/transforms.js, as JSON)')
    conf = json.loads(a.config)
    proc = processor(conf)
    if a.apply:
        rgb = np.frombuffer(sys.stdin.buffer.read(), dtype='<f4').reshape(-1, 3)
        sys.stdout.buffer.write(apply(proc, rgb).astype('<f4').tobytes())
        return
    n = a.size
    if a.format == 'cube1d':
        v = np.linspace(0.0, 1.0, n, dtype=np.float32)
        rgb = np.nan_to_num(apply(proc, np.stack([v, v, v], axis=1)), nan=0.0, posinf=65504.0, neginf=-65504.0)
        with open(a.out + '.part', 'w') as f:
            f.write(f'LUT_1D_SIZE {n}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
            np.savetxt(f, rgb, fmt='%.9g')
        os.replace(a.out + '.part', a.out)
        return
    lut = table(proc, n)
    if a.check:
        p = np.random.default_rng(1).random((200000, 3), dtype=np.float32)
        exact = apply(proc, p)
        ok = np.all(np.isfinite(exact), axis=1)
        err = np.abs(tetra(lut, n, p) - exact)[ok]
        print(json.dumps({'size': n, 'max': float(err.max() * 1023), 'p99': float(np.percentile(err, 99) * 1023)}))
        return
    if not a.out:
        raise SystemExit('give --out')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    title = a.name or conf['kind']
    if a.format == 'cube':
        write_cube(a.out, lut, n, title)
    else:
        write_mlut(a.out, lut, n, {'name': a.name, 'hash': a.hash, 'config': conf, 'ocio': ocio.__version__})


if __name__ == '__main__':
    main()
