#!/usr/bin/env python3
"""Lower the arms of a T-pose GLB so the figure stands relaxed (arms hang at the sides).

  python3 tools/pose_arms_down.py IN.glb OUT.glb [--angle 78] [--flip-y]

Rotates every arm vertex about its shoulder joint with a smooth blend across the shoulder (the torso is untouched),
recomputes the normals and writes a GLB with the same layout. --flip-y is for the bundled female file, whose source
vertical axis points downwards (the SDK normalises that at load time, so the file is written back the same way).
"""
import sys, json, struct, argparse
import numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import optimize_glb as O

ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst')
ap.add_argument('--angle', type=float, default=78.0, help='degrees the arms swing down (90 = straight down)')
ap.add_argument('--flip-y', action='store_true'); ap.add_argument('--pivot', type=float, nargs=2, default=None, help='shoulder joint |x| y (model units); default = detected')
a = ap.parse_args()
J, bo, d = O.load(a.src); d = bytearray(d)
prim = J['meshes'][0]['primitives'][0]
pa, na = prim['attributes']['POSITION'], prim['attributes']['NORMAL']
P = O.acc(J, bo, d, pa).astype(np.float64).copy(); I = O.acc(J, bo, d, prim['indices']).astype(np.int64).reshape(-1, 3)
N0 = O.acc(J, bo, d, na).astype(np.float64).copy()
S = -1.0 if a.flip_y else 1.0
Y = P[:, 1] * S                                   # work with Y pointing up
H = Y.max() - Y.min(); y0 = Y.min()
# ---- find the arms: the widest slice of the body above the hips is the T-pose hands
top = Y > y0 + 0.7 * H; xmax = np.abs(P[top, 0]).max()
arm = top & (np.abs(P[:, 0]) > 0.5 * xmax); ay = np.median(Y[arm])            # height of the outstretched arm
torso = (np.abs(Y - (y0 + 0.66 * H)) < 0.02 * H); tx = np.abs(P[torso, 0]).max()  # half width of the torso at chest height
px = a.pivot[0] if a.pivot else 0.105 * H; py = a.pivot[1] if a.pivot else ay + 0.004 * H
print(f'height {H:.3f}  arm height {ay:.3f}  torso half-width {tx:.3f}  pivot ({px:.3f}, {py:.3f})')
ax_ = np.abs(P[:, 0]); sg = np.sign(P[:, 0]); sg[sg == 0] = 1
t = np.clip((ax_ - 0.105 * H) / (0.06 * H), 0, 1); w = t * t * (3 - 2 * t)         # 0 on the torso -> 1 on the arm
w[Y < y0 + 0.66 * H - 0.12 * H] = 0                                                   # never move hips / legs
phi = np.radians(a.angle) * w
dx = ax_ - px; dy = Y - py
nx = px + dx * np.cos(phi) + dy * np.sin(phi); ny = py - dx * np.sin(phi) + dy * np.cos(phi)
P[:, 0] = sg * nx; P[:, 1] = ny * S
# ---- smooth normals (orientation taken from the original normals)
n = np.zeros_like(P); tri = P[I]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
for k in range(3): np.add.at(n, I[:, k], fn)
n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
if (n * N0).sum() < 0: n = -n
# ---- write back (same accessor layout, new min / max)
def put(i, arr):
    ac = J['accessors'][i]; bv = J['bufferViews'][ac['bufferView']]; off = bo + bv.get('byteOffset', 0) + ac.get('byteOffset', 0)
    assert not bv.get('byteStride') or bv['byteStride'] == 12
    d[off:off + arr.size * 4] = arr.astype('<f4').tobytes()
    if 'min' in ac: ac['min'] = arr.min(0).astype(float).tolist(); ac['max'] = arr.max(0).astype(float).tolist()
put(pa, P); put(na, n)
js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
bl, = struct.unpack('<I', d[bo - 8:bo - 4]); binary = bytes(d[bo:bo + bl])
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
open(a.dst, 'wb').write(out)
print('wrote', a.dst, 'x range', P[:, 0].min().round(3), P[:, 0].max().round(3))
