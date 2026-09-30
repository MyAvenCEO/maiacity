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
#   python3 scripts/film/color/bake.py --config '<json>' --apply  < rgb.f32 > out.f32
#       the exact transform (no LUT) on float32 RGB triples: the reference the tests measure ffmpeg against
#   python3 scripts/film/color/bake.py --config '<json>' --size 65 --check
#       how far a LUT of that size is from OCIO itself (10-bit code values)
#
# Config kinds: 'ocio-view' (a colour space to a display/view), 'ocio-convert' (src → dst colour space) and
# 'ocio-group' (builtin curves, matrices and conversions chained). 'identity' and 'math' configs are exact maths the
# worker does with ffmpeg filters (and the Mac app natively, cst.rs); they are not baked here.
#
# Needs OpenColorIO ≥ 2.5 and numpy (pip install opencolorio numpy).
import sys, os, json, argparse
import numpy as np
import PyOpenColorIO as ocio


def processor(conf):
    kind = conf['kind']
    if kind not in ('ocio-view', 'ocio-convert', 'ocio-group'):
        raise SystemExit(f"a '{kind}' transform is exact maths: the worker does it with ffmpeg filters, nothing to bake")
    cfg = ocio.Config.CreateFromBuiltinConfig(conf['config'])
    if kind == 'ocio-view':
        if conf.get('direction', 'forward') != 'forward':
            raise SystemExit('a view transform goes forward: a colour space to the display')
        t = ocio.DisplayViewTransform(src=conf['colorspace'], display=conf['display'], view=conf['view'], direction=ocio.TRANSFORM_DIR_FORWARD)
        return cfg.getProcessor(t).getDefaultCPUProcessor()
    if kind == 'ocio-convert':
        return cfg.getProcessor(conf['src'], conf['dst']).getDefaultCPUProcessor()
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
    ap.add_argument('--format', choices=['cube', 'cube1d'], default='cube')
    ap.add_argument('--out')
    ap.add_argument('--name', default='')
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
    write_cube(a.out, lut, n, a.name or conf['kind'])


if __name__ == '__main__':
    main()
