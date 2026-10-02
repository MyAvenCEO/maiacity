#!/usr/bin/env python3
"""
THE ISAR FROM THE WITTELSBACHERBRÜCKE SOUTH TO THE RAILWAY BRIDGE — the data its world is built from
(src/lib/worlds/isar): the river, its banks, paths, gravel bars, woods, trees and benches, both bridges and the town
round them from OpenStreetMap, and the ground's real heights from the Bavarian survey's 1 m terrain model (DGM1).

    python3 scripts/worlds/isar-map.py

It fetches what it needs once (into the system's temp folder, `maiacity-isar/`) and writes:
    src/lib/worlds/isar/map.json   every feature, in the world's metres
    src/lib/worlds/isar/ground.bin the ground's heights on the world's grid (Int16, centimetres)

Both sources are open and are credited wherever the world is shown:
    · © OpenStreetMap contributors, ODbL 1.0 — openstreetmap.org/copyright (map.json is a database derived from it,
      and so is itself under the ODbL)
    · DGM1 © Bayerische Vermessungsverwaltung, CC BY 4.0 — geodaten.bayern.de/opengeodata (resampled to the world's
      grid, the riverbed shaped under the water)

The world's axes: x east, z south, y up, in metres, from a point midway between the two bridges on the river
(ETRS89 / UTM 32N 690850 E, 5332890 N); y 0 is the water's surface there. The river's own frame: s along it,
downstream (north-east), n across it, towards the east bank. The DGM is the bare earth: no buildings, no trees, no
bridges, and over the water only the water's surface — the riverbed under it is shaped here, deepest along the
steep west bank and shallow over the gravel on the east.
"""
import json
import math
import os
import struct
import sys
import tempfile
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'lib', 'worlds', 'isar')
CACHE = os.path.join(tempfile.gettempdir(), 'maiacity-isar')
UA = 'maiaCITY-worldbuilder/1.0 (+https://maia.city)'

# the world's origin and the river's frame (s downstream, n towards the east bank)
E0, N0 = 690850.0, 5332890.0
U = (0.69863, -0.71548)
V = (0.71548, 0.69863)
# the ground's extent in the river's frame: the two bridges stand at s ≈ ∓343
S_RANGE, N_RANGE = (-600.0, 600.0), (-260.0, 360.0)
GROUND = {'s': S_RANGE, 'n': N_RANGE}
# where the town round it is kept, for the skyline (the landmarks beyond it are kept on their own)
KEEP = {'s': (-760.0, 860.0), 'n': (-380.0, 460.0)}

# OpenStreetMap, in tiles the API serves (each under its 50 000-node limit)
OSM_TILES = [(lon, lat, lon + 0.0095, lat + 0.0095) for lon in (11.5520, 11.5615, 11.5710) for lat in (48.1090, 48.1185)]
# DGM1 tiles (km east _ km north of their south-west corner)
DGM_TILES = ['690_5332', '690_5333', '691_5332', '691_5333']


# ── fetching, once ──────────────────────────────────────────────────────────────────────────────────────────────────

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print('fetching', url)
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=180) as r, open(path + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(path + '.part', path)
    return path


def osm():
    nodes, ways, rels = {}, {}, {}
    for b in OSM_TILES:
        bbox = ','.join(f'{v:.4f}' for v in b)
        path = fetch(f'https://api.openstreetmap.org/api/0.6/map.json?bbox={bbox}', f'osm-{bbox}.json')
        for e in json.load(open(path))['elements']:
            if e['type'] == 'node':
                nodes[e['id']] = e
            elif e['type'] == 'way':
                ways[e['id']] = e
            else:
                rels[e['id']] = e
    return nodes, ways, rels


def dgm():
    """The four tiles as one 2 × 2 km mosaic: row 0 is the north edge (5334000 N), column 0 the west (690000 E)."""
    m = np.zeros((2000, 2000), np.float32)
    for t in DGM_TILES:
        path = fetch(f'https://download1.bayernwolke.de/a/dgm/dgm1/{t}.tif', f'dgm1-{t}.tif')
        e, n = (int(v) for v in t.split('_'))
        r0 = (5334 - (n + 1)) * 1000
        c0 = (e - 690) * 1000
        m[r0:r0 + 1000, c0:c0 + 1000] = np.array(Image.open(path), dtype=np.float32)
    return m


# ── where things are ────────────────────────────────────────────────────────────────────────────────────────────────

def utm(lat, lon, zone=32):
    """WGS84 / ETRS89 latitude and longitude to UTM (the survey's grid), metres."""
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    phi, lam = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T, C, A = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2, math.cos(phi) * (lam - lon0)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi) - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000
    y = k0 * (M + N * math.tan(phi) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24 + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, y


def local(node):
    e, n = utm(node['lat'], node['lon'])
    return (e - E0, N0 - n)


def to_sn(x, z):
    return (x * U[0] + z * U[1], x * V[0] + z * V[1])


def to_xz(s, n):
    return (s * U[0] + n * V[0], s * U[1] + n * V[1])


def inside(p, rng=None):
    s, n = to_sn(*p)
    r = rng or KEEP
    return r['s'][0] <= s <= r['s'][1] and r['n'][0] <= n <= r['n'][1]


# ── the shapes ──────────────────────────────────────────────────────────────────────────────────────────────────────

def simplify(pts, tol):
    """Douglas–Peucker: drop the points a line can do without (tol metres)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, az), (bx, bz) = pts[a], pts[b]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        best, at = 0.0, -1
        for i in range(a + 1, b):
            # a closed ring starts where it ends: then how far from that point
            d = abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L if L > 1e-6 else math.hypot(pts[i][0] - ax, pts[i][1] - az)
            if d > best:
                best, at = d, i
        if best > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def flat(pts, tol=0.0):
    pts = simplify(pts, tol) if tol else pts
    return [round(v, 1) for p in pts for v in p]


def stitch(segments):
    """Join a multipolygon's ways into closed rings."""
    rings, open_ = [], [list(s) for s in segments if len(s) > 1]
    while open_:
        ring = open_.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(open_):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s + ring[1:]
                elif s[0] == ring[0]:
                    ring = s[::-1] + ring[1:]
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        if ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def main():
    nodes, ways, rels = osm()
    M = dgm()
    pt = lambda nid: local(nodes[nid])
    way_pts = lambda w: [pt(n) for n in w['nodes'] if n in nodes]

    def dgm_at(x, z):
        """the bare earth at x, z (m above sea level), bilinear"""
        c = (x + E0) - 690000 - 0.5
        r = 5334000 - (N0 - z) - 0.5
        c = np.clip(c, 0, 1998.999)
        r = np.clip(r, 0, 1998.999)
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        return (M[r0, c0] * (1 - fc) * (1 - fr) + M[r0, c0 + 1] * fc * (1 - fr) + M[r0 + 1, c0] * (1 - fc) * fr + M[r0 + 1, c0 + 1] * fc * fr)

    # ── the water: the Isar's areas (its multipolygons and the canal's mouth by the railway bridge) ──
    river_rings, island_rings = [], []
    for r in rels.values():
        t = r.get('tags', {})
        if t.get('natural') == 'water' and t.get('water') == 'river' and t.get('type') == 'multipolygon':
            outer = [way_pts(ways[m['ref']]) for m in r['members'] if m['type'] == 'way' and m['role'] == 'outer' and m['ref'] in ways]
            inner = [way_pts(ways[m['ref']]) for m in r['members'] if m['type'] == 'way' and m['role'] == 'inner' and m['ref'] in ways]
            for ring in stitch([[tuple(p) for p in o] for o in outer]):
                if any(inside(p) for p in ring):
                    river_rings.append(ring)
            for ring in stitch([[tuple(p) for p in o] for o in inner]):
                if any(inside(p, {'s': S_RANGE, 'n': N_RANGE}) for p in ring):
                    island_rings.append(ring)
    mouth_rings = []
    for w in ways.values():
        t = w.get('tags', {})
        if t.get('natural') == 'water' and t.get('water') not in ('pond', 'basin', 'reservoir', 'wastewater') and w['nodes'][0] == w['nodes'][-1]:
            pts = way_pts(w)
            sn = [to_sn(*p) for p in pts]
            # the mouth of the Westermühlbach's channel, at the river's level, beside the railway bridge on the west bank
            if all(-300 < s < -180 and -120 < n < -20 for s, n in sn):
                mouth_rings.append(pts)

    # ── rasters in the river's frame, 0.5 m: the water, the islands ──
    CELL = 0.5
    W = int((S_RANGE[1] - S_RANGE[0]) / CELL)
    H = int((N_RANGE[1] - N_RANGE[0]) / CELL)

    def raster(rings, holes=()):
        im = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(im)
        px = lambda ring: [((to_sn(*p)[0] - S_RANGE[0]) / CELL, (to_sn(*p)[1] - N_RANGE[0]) / CELL) for p in ring]
        for ring in rings:
            d.polygon(px(ring), fill=1)
        for ring in holes:
            d.polygon(px(ring), fill=0)
        return np.array(im, dtype=bool)

    isar = raster(river_rings, island_rings)
    mouth = raster(mouth_rings)
    water = isar | mouth
    islands = raster(island_rings)
    cs = S_RANGE[0] + (np.arange(W) + 0.5) * CELL
    cn = N_RANGE[0] + (np.arange(H) + 0.5) * CELL
    SS, NN = np.meshgrid(cs, cn)
    XX, ZZ = SS * U[0] + NN * V[0], SS * U[1] + NN * V[1]

    # ── the datum: the water's surface, a plane falling along the river (fitted to the DGM over the water) ──
    ground = dgm_at(XX, ZZ)
    core = isar & (np.abs(SS) < 420)
    zs, hs = SS[core], ground[core]
    b, a = np.polyfit(zs, hs, 1)
    # the DGM's water is not always flat (a ripple, a bar just under): fit again to what lies near the plane
    near = np.abs(hs - (a + b * zs)) < 0.25
    b, a = np.polyfit(zs[near], hs[near], 1)
    datum = round(float(a), 2)
    slope = round(float(b), 6)
    level = lambda s: slope * s
    print(f'water: {datum} m above sea level at s 0, falling {-slope * 1000:.2f} m per km')

    # ── the riverbed: deepest along the steep outer (west) bank, rising gently over the gravel to the east ──
    def dist(mask, reach):
        """approximate distance (m) from each cell to the nearest cell of `mask`, up to `reach` (dilation, octagonal)"""
        d = np.where(mask, 0.0, np.inf)
        cur = mask.copy()
        steps = int(reach / CELL)
        for k in range(1, steps + 1):
            grow = cur.copy()
            grow[1:, :] |= cur[:-1, :]
            grow[:-1, :] |= cur[1:, :]
            grow[:, 1:] |= cur[:, :-1]
            grow[:, :-1] |= cur[:, 1:]
            if k % 2 == 0:  # every other step the diagonals too: an octagon, near enough a circle
                grow[1:, 1:] |= cur[:-1, :-1]
                grow[:-1, :-1] |= cur[1:, 1:]
                grow[1:, :-1] |= cur[:-1, 1:]
                grow[:-1, 1:] |= cur[1:, :-1]
            new = grow & ~cur
            d[new] = k * CELL
            cur = grow
        return d

    land = ~water
    to_shore = dist(land, 30)  # inside the water: how far to the nearest bank or island
    to_island = dist(islands, 12)
    # each column across the river: its west and east banks
    has = isar.any(axis=0)
    first = np.where(has, isar.argmax(axis=0), 0)
    last = np.where(has, H - 1 - isar[::-1].argmax(axis=0), 0)
    nW = N_RANGE[0] + (first + 0.5) * CELL
    nE = N_RANGE[0] + (last + 0.5) * CELL
    width = np.maximum(nE - nW, 5.0)
    t = np.clip((NN - nW[None, :]) / width[None, :], 0, 1)
    TH = 0.3  # the deepest line, a third of the way over from the west bank
    profile = np.where(t < TH, 1 - (1 - t / TH) ** 3, (1 - (t - TH) / (1 - TH)) ** 1.6)
    g = lambda s, at, w: np.exp(-((s - at) / w) ** 2)
    # the river is deeper in pools and shallow over its riffles (where its surface breaks white)
    deepest = 1.75 - 1.0 * g(SS, -125, 32) - 1.05 * g(SS, 255, 28) + 0.45 * g(SS, 40, 70) - 0.4 * g(SS, -330, 40)
    depth = deepest * profile
    depth = np.minimum(depth, 0.1 + to_shore * 0.22)  # no cliffs: the bed falls away from every shore
    depth *= np.clip(to_island / 9.0, 0.25, 1.0) ** 0.8  # shallow round the gravel islands
    depth = np.where(mouth & ~isar, np.minimum(0.55, 0.05 + to_shore * 0.2), depth)
    # a little unevenness: gravel ridges and hollows across the flow (seeded, the same every time)
    rng = np.random.default_rng(1905)
    ph = rng.uniform(0, 2 * np.pi, 6)
    rough = (0.08 * np.sin(SS / 9.0 + ph[0]) * np.sin(NN / 6.0 + ph[1]) + 0.05 * np.sin(SS / 3.7 + NN / 5.3 + ph[2])
             + 0.04 * np.sin(SS / 2.1 - NN / 2.9 + ph[3]))
    bed = level(SS) - np.maximum(0.02, depth + rough * np.clip(depth / 0.6, 0, 1))
    height = ground - datum
    height = np.where(water, np.minimum(height, bed), height)

    # ── the world's ground: a tensor grid, finest where one walks ──
    def axis(lo, hi, core_lo, core_hi, step, outer):
        xs = list(np.arange(core_lo, core_hi + 1e-6, step))
        v, d = core_lo, step
        while v > lo:
            d = min(outer, d * 1.12)
            v = max(lo, v - d)
            xs.insert(0, v)
        v, d = core_hi, step
        while v < hi:
            d = min(outer, d * 1.12)
            v = min(hi, v + d)
            xs.append(v)
        return [round(float(x), 2) for x in xs]

    gs = axis(S_RANGE[0], S_RANGE[1], -460, 460, 1.75, 8)
    gn = axis(N_RANGE[0], N_RANGE[1], -95, 170, 1.0, 8)
    # sample the 0.5 m raster at the grid's points (bilinear)
    def sample(field, s, n):
        fi = np.clip((s - S_RANGE[0]) / CELL - 0.5, 0, W - 1.001)
        fj = np.clip((n - N_RANGE[0]) / CELL - 0.5, 0, H - 1.001)
        i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
        di, dj = fi - i0, fj - j0
        return (field[j0, i0] * (1 - di) * (1 - dj) + field[j0, i0 + 1] * di * (1 - dj) + field[j0 + 1, i0] * (1 - di) * dj + field[j0 + 1, i0 + 1] * di * dj)

    GS, GN = np.meshgrid(np.array(gs), np.array(gn))
    heights = sample(height, GS, GN)
    cm = np.clip(np.round(heights * 100), -32768, 32767).astype('<i2')
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'ground.bin'), 'wb') as f:
        f.write(cm.tobytes())
    print(f'ground: {len(gs)} × {len(gn)} points, {heights.min():.2f} … {heights.max():.2f} m')

    # ── the features, in the world's metres ──
    out = {
        'source': ('Map data © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright); this map, derived from it, is '
                   'itself under the ODbL. Terrain: DGM1 © Bayerische Vermessungsverwaltung, CC BY 4.0 '
                   '(geodaten.bayern.de/opengeodata), resampled to this grid with the riverbed shaped under the water.'),
        'origin': {'e': E0, 'n': N0, 'zone': '32N', 'datum': datum},
        'frame': {'u': list(U), 'v': list(V)},
        'river': {'slope': slope},
        'grid': {'s': gs, 'n': gn},
        'water': [flat(r, 0.2) for r in river_rings + mouth_rings],
        'islands': [flat(r, 0.2) for r in island_rings],
    }
    area = lambda w: w['nodes'][0] == w['nodes'][-1] and len(w['nodes']) > 3
    keep_area = lambda pts: any(inside(p, GROUND) for p in pts)

    def tagged(pred, tol, closed=True):
        res = []
        for w in ways.values():
            t = w.get('tags', {})
            if not pred(t) or (closed and not area(w)):
                continue
            pts = way_pts(w)
            if pts and keep_area(pts):
                res.append(flat(pts, tol))
        for r in rels.values():
            t = r.get('tags', {})
            if t.get('type') != 'multipolygon' or not pred(t):
                continue
            outer = [[tuple(p) for p in way_pts(ways[m['ref']])] for m in r['members'] if m['type'] == 'way' and m['role'] == 'outer' and m['ref'] in ways]
            for ring in stitch(outer):
                if keep_area(ring):
                    res.append(flat(ring, tol))
        return res

    out['shingle'] = tagged(lambda t: t.get('natural') in ('shingle', 'sand') or t.get('man_made') == 'breakwater', 0.2)
    out['grass'] = tagged(lambda t: t.get('landuse') in ('grass', 'meadow', 'village_green') or t.get('natural') == 'grassland' or t.get('leisure') == 'park', 0.4)
    out['wood'] = tagged(lambda t: t.get('natural') == 'wood' or t.get('landuse') == 'forest', 0.4)
    out['scrub'] = tagged(lambda t: t.get('natural') in ('scrub', 'heath'), 0.4)
    out['pitch'] = tagged(lambda t: t.get('leisure') in ('pitch', 'track', 'swimming_pool', 'playground'), 0.4)

    # the paths and streets: what they are made of, how wide
    WIDTH = {'footway': 2.2, 'path': 2.4, 'cycleway': 2.6, 'track': 2.8, 'steps': 2.0, 'pedestrian': 6.0, 'service': 4.0,
             'residential': 7.0, 'tertiary': 9.0, 'secondary': 12.0, 'secondary_link': 6.0, 'unclassified': 6.0, 'living_street': 6.0}
    paths = []
    for w in ways.values():
        t = w.get('tags', {})
        hw = t.get('highway')
        if hw not in WIDTH or t.get('tunnel') in ('yes', 'building_passage', 'culvert') or t.get('area') == 'yes':
            continue
        pts = way_pts(w)
        if not pts or not any(inside(p, GROUND) for p in pts):
            continue
        surface = t.get('surface', 'asphalt' if hw in ('residential', 'tertiary', 'secondary', 'secondary_link', 'service', 'unclassified', 'cycleway') else 'ground')
        kind = ('asphalt' if surface in ('asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'concrete:plates', 'metal') else
                'dirt' if surface in ('dirt', 'grass', 'earth', 'mud', 'sand') else 'gravel')
        if hw == 'steps':
            kind = 'steps'
        try:
            width = float(t.get('width', '').split()[0])
        except (ValueError, IndexError):
            width = WIDTH[hw]
        # the gravel paths by the river are a cart's width, wider than a footway (the photos, July 2023)
        if hw in ('footway', 'path') and kind == 'gravel' and 'width' not in t:
            width = 2.8
        paths.append({'k': kind, 'hw': hw, 'w': round(min(width, 16), 1), 'b': 1 if t.get('bridge') == 'yes' else 0, 'pts': flat(pts, 0.15)})
    # OpenStreetMap draws the east bank's path straight past the Wittelsbacherbrücke's third pier, two nodes 78 m apart;
    # on the ground it bends out to pass under the middle of the third arch (the photos, July 2023)
    for p in paths:
        pts = [(p['pts'][i], p['pts'][i + 1]) for i in range(0, len(p['pts']), 2)]
        sn = [to_sn(*q) for q in pts]
        for k in range(len(sn) - 1):
            (s1, n1), (s2, n2) = sn[k], sn[k + 1]
            if s1 < 320 < s2 and 45 < n1 < 60 and 45 < n2 < 62 and s2 - s1 > 40:
                bend = [to_xz(s, n) for s, n in ((328, 59.5), (341.5, 64.5), (356, 61.5))]
                pts[k + 1:k + 1] = bend
                p['pts'] = flat(pts)
                break
    out['paths'] = paths

    out['rail'] = [flat(way_pts(w), 0.1) for w in ways.values() if w.get('tags', {}).get('railway') in ('rail', 'light_rail') and any(inside(p, {'s': (-700, 200), 'n': (-400, 400)}) for p in way_pts(w))]

    # ── the bridges ──
    def named_area(name):
        for w in ways.values():
            t = w.get('tags', {})
            if t.get('man_made') == 'bridge' and t.get('name') == name:
                return way_pts(w)
        return None

    def way_named(pred):
        for w in ways.values():
            if pred(w.get('tags', {})):
                return way_pts(w)
        return None

    statue = next((local(nd) for nd in nodes.values() if nd.get('tags', {}).get('name') == 'Otto-von-Wittelsbach-Reiterstandbild'), None)
    witt_road = way_named(lambda t: t.get('highway') == 'secondary' and t.get('name') == 'Wittelsbacherbrücke' and t.get('bridge') == 'yes' and t.get('layer') == '1')
    braunau = named_area('Braunauer Eisenbahnbrücke')
    rail_bridge = [way_pts(w) for w in ways.values() if w.get('tags', {}).get('railway') == 'rail' and w.get('tags', {}).get('bridge') == 'yes' and any(inside(p, {'s': (-420, -250), 'n': (-80, 140)}) for p in way_pts(w))]
    out['bridges'] = {
        'wittelsbacher': {
            'outline': flat(named_area('Wittelsbacherbrücke') or [], 0.05),
            'road': flat(witt_road or []),
            'statue': [round(v, 2) for v in statue] if statue else None,
            # the street at either end, from the DGM (m above the water at s 0)
            'ends': [round(float(dgm_at(*p)) - datum, 2) for p in ((witt_road[0], witt_road[-1]) if witt_road else ())],
        },
        'braunauer': {
            'outline': flat(braunau or [], 0.05),
            'rails': [flat(r, 0.05) for r in rail_bridge],
        },
    }
    if witt_road:
        # the street's height a little beyond each end of the bridge: the deck runs between them
        a, b2 = np.array(witt_road[0]), np.array(witt_road[-1])
        d = (b2 - a) / np.linalg.norm(b2 - a)
        out['bridges']['wittelsbacher']['ends'] = [round(float(dgm_at(*(a - d * 6))) - datum, 2), round(float(dgm_at(*(b2 + d * 6))) - datum, 2)]
    if rail_bridge:
        a, b2 = np.array(rail_bridge[0][0]), np.array(rail_bridge[0][-1])
        d = (b2 - a) / np.linalg.norm(b2 - a)
        out['bridges']['braunauer']['ends'] = [round(float(dgm_at(*(a - d * 6))) - datum, 2), round(float(dgm_at(*(b2 + d * 6))) - datum, 2)]

    # ── trees, benches ──
    out['trees'] = [[round(v, 1) for v in local(nd)] for nd in nodes.values() if nd.get('tags', {}).get('natural') == 'tree' and inside(local(nd), {'s': S_RANGE, 'n': N_RANGE})]
    out['treeRows'] = [flat(way_pts(w), 0.3) for w in ways.values() if w.get('tags', {}).get('natural') == 'tree_row' and any(inside(p, {'s': S_RANGE, 'n': N_RANGE}) for p in way_pts(w))]
    benches = []
    for nd in nodes.values():
        if nd.get('tags', {}).get('amenity') != 'bench':
            continue
        p = local(nd)
        s, n = to_sn(*p)
        if not (-460 < s < 460 and -120 < n < 170):
            continue
        benches.append([round(p[0], 1), round(p[1], 1)])
    out['benches'] = benches

    # ── the town: every building's footprint, its foot on the ground and its height ──
    LEVEL = 3.3
    DEFAULT = {'apartments': 5, 'residential': 5, 'house': 2, 'detached': 2, 'commercial': 4, 'retail': 2, 'office': 5, 'school': 3, 'church': 6,
               'industrial': 3, 'warehouse': 3, 'greenhouse': 1, 'garages': 1, 'garage': 1, 'shed': 1, 'hut': 1, 'kiosk': 1, 'service': 1, 'roof': 1}

    def num(v):
        try:
            return float(str(v).replace('m', '').strip().split()[0])
        except (ValueError, IndexError):
            return None

    buildings = []
    for w in ways.values():
        t = w.get('tags', {})
        kind = t.get('building')
        if not kind or not area(w) or t.get('location') == 'underground' or t.get('layer', '0').startswith('-'):
            continue
        pts = way_pts(w)
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        if not inside((cx, cz)):
            continue
        h = num(t.get('height'))
        levels = num(t.get('building:levels'))
        roof_h = num(t.get('roof:height'))
        roof = t.get('roof:shape')
        if h is None:
            lv = levels if levels is not None else DEFAULT.get(kind, 3)
            h = lv * LEVEL + (0.6 if kind not in ('greenhouse', 'garages', 'garage', 'shed', 'hut', 'kiosk') else 0)
            if roof is None and kind in ('apartments', 'residential', 'house', 'detached', 'yes', 'commercial', 'office'):
                roof = 'hipped'
            if roof in ('hipped', 'gabled'):
                roof_h = roof_h or (4.5 if lv >= 3 else 3.0)
                h += roof_h
        base = float(min(dgm_at(*p) for p in pts)) - datum
        rec = {'pts': flat(pts, 0.3), 'y': round(base, 2), 'h': round(h, 1)}
        if roof in ('hipped', 'gabled', 'pyramidal', 'half-hipped', 'mansard'):
            rec['roof'] = 'hipped' if roof != 'gabled' else 'gabled'
            rec['rh'] = round(roof_h or 4.0, 1)
        if num(t.get('min_height')):
            rec['min'] = num(t.get('min_height'))
        if kind == 'greenhouse':
            rec['glass'] = 1
        buildings.append(rec)
    out['buildings'] = buildings

    # ── what stands out on the skyline: St. Maximilian's two towers (north, beyond the Wittelsbacherbrücke), the
    #    Heizkraftwerk Süd's chimneys and its heat store (south, beyond the railway bridge) ──
    marks = {'chimneys': [], 'tanks': [], 'plant': []}
    for w in ways.values():
        t = w.get('tags', {})
        pts = way_pts(w)
        if not pts or not area(w):
            continue
        cx = sum(p[0] for p in pts[:-1]) / (len(pts) - 1)
        cz = sum(p[1] for p in pts[:-1]) / (len(pts) - 1)
        r = sum(math.hypot(p[0] - cx, p[1] - cz) for p in pts[:-1]) / (len(pts) - 1)
        if t.get('man_made') == 'chimney' or (r < 10 and (num(t.get('height')) or 0) > 60):
            marks['chimneys'].append({'at': [round(cx, 1), round(cz, 1)], 'r': round(r, 2), 'h': num(t.get('height')) or 100, 'y': round(float(dgm_at(cx, cz)) - datum, 2)})
        elif t.get('man_made') == 'storage_tank' and (num(t.get('height')) or 0) > 20:
            marks['tanks'].append({'at': [round(cx, 1), round(cz, 1)], 'r': round(r, 2), 'h': num(t.get('height')), 'y': round(float(dgm_at(cx, cz)) - datum, 2)})
        elif t.get('building') == 'church' and t.get('name') == 'St. Maximilian':
            marks['maximilian'] = {'pts': flat(pts, 0.3), 'y': round(float(min(dgm_at(*p) for p in pts)) - datum, 2)}
        elif t.get('building') in ('industrial', 'yes', 'service', 'warehouse') and not inside((cx, cz)) and math.hypot(cx + 635, cz - 720) < 170:
            # the Heizkraftwerk Süd's halls, beyond the town kept for the skyline: their height where the map has it
            marks['plant'].append({'pts': flat(pts, 0.5), 'y': round(float(dgm_at(cx, cz)) - datum, 2), 'h': num(t.get('height')) or (38 if t.get('name') == 'GuD1' else 22)})
    out['landmarks'] = marks

    with open(os.path.join(OUT, 'map.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    size = os.path.getsize(os.path.join(OUT, 'map.json'))
    print(f'map: {size / 1024:.0f} KB — {len(out["water"])} waters, {len(out["paths"])} paths, {len(out["buildings"])} buildings, '
          f'{len(out["trees"])} trees, {len(out["benches"])} benches, {len(marks["chimneys"])} chimneys')


if __name__ == '__main__':
    sys.exit(main())
