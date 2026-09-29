# Bakes the film pipeline's colour transforms into 3D LUTs, from the official ACES 2.0 studio config that OpenColorIO
# carries built in. Run it only when a transform changes: the LUTs are committed (static/film/luts/<name>.lut — the
# studio fetches them from the site, the render worker reads them from the repo) and pinned by their CIDs in
# game/film/transforms.json (bun scripts/film/color/pin.ts), so a render always uses exactly the same numbers.
#
#   python3 scripts/film/color/bake.py [--check]
#
# Needs OpenColorIO and numpy (pip install opencolorio numpy). --check only reports how far each LUT is from OCIO.
#
# The .lut format, small enough for git: gzip of  b'MLUT1' · uint32 LE header length · the header (JSON: name, size,
# min, max, title, config) · size³ × RGB as uint16 LE, red fastest, each value min + (max − min) · u / 65535.
import sys, os, gzip, json, struct
import numpy as np
import PyOpenColorIO as ocio

CONFIG = 'studio-config-v4.0.0_aces-v2.0_ocio-v2.5'
DISPLAY = 'Rec.1886 Rec.709 - Display'
VIEW = 'ACES 2.0 - SDR 100 nits (Rec.709)'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '../../../static/film/luts'))
cfg = ocio.Config.CreateFromBuiltinConfig(CONFIG)

def view(direction, display=DISPLAY, view=VIEW):
    t = ocio.DisplayViewTransform(src='ACEScct', display=display, view=view, direction=direction)
    return cfg.getProcessor(t).getDefaultCPUProcessor()

def convert(src, dst):
    return cfg.getProcessor(src, dst).getDefaultCPUProcessor()

# name → (processor, size, what it is)
TRANSFORMS = {
    # the output transform: the timeline (ACEScct) to what every delivery shows (Rec.709, BT.1886 gamma 2.4, SDR)
    'odt-rec709': (view(ocio.TRANSFORM_DIR_FORWARD), 65, f'ACEScct → {DISPLAY}, {VIEW}'),
    # its inverse: a display-referred picture (Rec.709/sRGB video, stills, the old graded shots) into the timeline, so
    # that it comes out of the output transform exactly as it went in
    'idt-rec709': (view(ocio.TRANSFORM_DIR_INVERSE), 65, f'{DISPLAY} (via the inverse of {VIEW}) → ACEScct'),
    # HDR video from a phone or camera: the inverse of the ACES 2.0 HDR output transforms
    'idt-hlg': (view(ocio.TRANSFORM_DIR_INVERSE, 'Rec.2100-HLG - Display', 'ACES 2.0 - HDR 1000 nits (P3 D65)'), 33, 'Rec.2100 HLG (via the inverse of ACES 2.0 HDR 1000 nits) → ACEScct'),
    'idt-pq': (view(ocio.TRANSFORM_DIR_INVERSE, 'Rec.2100-PQ - Display', 'ACES 2.0 - HDR 1000 nits (P3 D65)'), 33, 'Rec.2100 PQ (via the inverse of ACES 2.0 HDR 1000 nits) → ACEScct'),
    # camera log: Apple Log (iPhone 15 Pro and later) — a scene-referred camera space, a plain conversion
    'idt-apple-log': (convert('Apple Log', 'ACEScct'), 33, 'Apple Log → ACEScct'),
}

def grid(n):
    v = np.linspace(0.0, 1.0, n, dtype=np.float32)
    # .cube order: red changes fastest, then green, then blue
    b, g, r = np.meshgrid(v, v, v, indexing='ij')
    return np.stack([r.ravel(), g.ravel(), b.ravel()], axis=1).astype(np.float32)

def apply(proc, rgb):
    out = rgb.copy()
    proc.applyRGB(out)
    return out

def write(name, proc, n, title):
    rgb = apply(proc, grid(n))
    rgb = np.nan_to_num(rgb, nan=0.0, posinf=1.0, neginf=0.0)
    lo, hi = float(rgb.min()), float(rgb.max())
    u = np.round((rgb - lo) / (hi - lo) * 65535).astype('<u2')
    head = json.dumps({'name': name, 'size': n, 'min': lo, 'max': hi, 'title': title, 'config': CONFIG, 'ocio': ocio.__version__}).encode()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.lut')
    # mtime 0: the same numbers always give the same bytes, and so the same CID
    with open(path, 'wb') as f, gzip.GzipFile(fileobj=f, mode='wb', mtime=0, filename='') as z:
        z.write(b'MLUT1' + struct.pack('<I', len(head)) + head + u.tobytes())
    return path, u.astype(np.float64) / 65535 * (hi - lo) + lo

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
    conds = [
        (fr >= fg) & (fg >= fb), (fr >= fb) & (fb > fg), (fb > fr) & (fr >= fg),
        (fg > fr) & (fr >= fb), (fg >= fb) & (fb > fr), (fb > fg) & (fg > fr),
    ]
    # the six tetrahedra: steps through the unit cube in the order of the largest fraction
    steps = [((1,0,0),(1,1,0)), ((1,0,0),(1,0,1)), ((0,0,1),(1,0,1)), ((0,1,0),(1,1,0)), ((0,1,0),(0,1,1)), ((0,0,1),(0,1,1))]
    weights = [(fr, fg, fb), (fr, fb, fg), (fb, fr, fg), (fg, fr, fb), (fg, fb, fr), (fb, fg, fr)]
    for c, (s1, s2), (w1, w2, w3) in zip(conds, steps, weights):
        c1, c2 = at(*s1), at(*s2)
        v = (1 - w1) * c000 + (w1 - w2) * c1 + (w2 - w3) * c2 + w3 * c111
        out = np.where(c, v, out)
    return out

def check(name, proc, n, lut=None):
    lut = apply(proc, grid(n)) if lut is None else lut
    rng = np.random.default_rng(1)
    p = rng.random((200000, 3), dtype=np.float32)
    exact = apply(proc, p)
    ok = np.all(np.isfinite(exact), axis=1)
    err = np.abs(tetra(lut, n, p) - exact)[ok]
    return err.max() * 1023, np.percentile(err, 99.9) * 1023

def matrix(src, dst):
    # the 3×3 a colour-space conversion reduces to, where it is linear: measured on the unit vectors
    proc = convert(src, dst)
    return apply(proc, np.eye(3, dtype=np.float32)).T

if __name__ == '__main__':
    only_check = '--check' in sys.argv
    for name, (proc, n, title) in TRANSFORMS.items():
        lut = None
        if not only_check:
            path, lut = write(name, proc, n, title)
        worst, p999 = check(name, proc, n, lut)
        print(f'{name:14s} {n}³  max {worst:6.2f}  99.9% {p999:5.2f}  (10-bit code values from OCIO, whole cube)')
    # the matrix game/film/color.js uses to take the world's linear light (Rec.709 primaries, D65) into ACES AP1
    print('Linear Rec.709 → ACEScg (AP1):')
    print(np.array2string(matrix('Linear Rec.709 (sRGB)', 'ACEScg'), precision=10, separator=', '))
    if not only_check:
        # the round trip every display-referred picture takes: in through idt-rec709, out through odt-rec709
        p = np.random.default_rng(2).random((200000, 3), dtype=np.float32)
        back = apply(TRANSFORMS['odt-rec709'][0], apply(TRANSFORMS['idt-rec709'][0], p))
        print(f'round trip rec709 → ACEScct → rec709 (OCIO itself): max {np.abs(back - p).max() * 1023:.3f} code values')
