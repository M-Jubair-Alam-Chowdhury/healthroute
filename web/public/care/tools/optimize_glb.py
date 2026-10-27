#!/usr/bin/env python3
"""Optimise a very dense, un-welded GLB (e.g. a 1.4M-triangle scan) for the Care Anatomy SDK.

  python3 tools/optimize_glb.py INPUT.glb OUTPUT.glb [--cell 0.00285] [--scale SX SY SZ]

Merges every mesh in the file into ONE static mesh (rig / skin data is dropped), bakes the node
transforms (Y-up output), welds duplicate vertices and recomputes smooth normals.
  --cell   cluster size as a fraction of the model height; reduces very dense scans
           (0.00285 ~ 5 mm on a 1.75 m body, smaller = more detail / bigger file; 0 = weld only).
  --scale  per-axis correction baked into the geometry (some rigged exports store the mesh
           squashed and let the skeleton stretch it back; the SDK ignores rigs, so correct it here).
Needs only numpy. The licence / author block of the source file is carried over.
"""
import sys, json, struct, argparse
import numpy as np

CT = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1', 5122: '<i2', 5120: 'i1'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def load(path):
    d = open(path, 'rb').read(); off = 12; js = None; b = None
    while off + 8 <= len(d):
        l, t = struct.unpack('<II', d[off:off + 8]); off += 8
        if t == 0x4E4F534A: js = json.loads(d[off:off + l])
        elif t == 0x004E4942 and b is None: b = off
        off += l
    return js, b, d

def acc(J, bo, d, i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]; n = NC[a['type']]
    dt = CT[a['componentType']]; sz = np.dtype(dt).itemsize; st = bv.get('byteStride') or n * sz
    base = bo + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    if st == n * sz: return np.frombuffer(d, dt, a['count'] * n, base).reshape(a['count'], n)
    raw = np.frombuffer(d, np.uint8, st * a['count'], base).reshape(a['count'], st)[:, :n * sz]
    return np.ascontiguousarray(raw).view(dt).reshape(a['count'], n)

def node_m(n):
    if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0]); x, y, z, w = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t; return M

def gather(J, bo, d, scale=(1, 1, 1), up_axis="z"):
    prims = []
    def walk(i, parent):
        n = J['nodes'][i]; m = parent @ node_m(n)
        if 'mesh' in n:
            for p in J['meshes'][n['mesh']]['primitives']:
                if p.get('mode', 4) == 4: prims.append((p, m))
        for c in n.get('children', []): walk(c, m)
    for i in J['scenes'][J.get('scene', 0)]['nodes']: walk(i, np.eye(4))
    Ps, Is, base = [], [], 0
    for p, m in prims:
        P = acc(J, bo, d, p['attributes']['POSITION']).astype(np.float64)
        I = acc(J, bo, d, p['indices']).astype(np.int64).reshape(-1, 3) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
        Ps.append(P @ m[:3, :3].T + m[:3, 3]); Is.append(I + base); base += len(P)
    P = np.vstack(Ps) * np.array(scale, float)
    # Normalize the source axis into the SDK's Y-up convention.
    # Y-up sources retain their vertical axis; Z-up sources rotate Z to +Y.
    if up_axis.lower() == "z":
        P = P[:, [0, 2, 1]] * np.array([1.0, 1.0, -1.0])
    elif up_axis.lower() == "y":
        P = P.copy()
    else:
        raise ValueError("--up-axis must be y or z")
    return P, np.vstack(Is)

def weld(P, I, tol):
    """merge vertices that sit at the same position (un-welded exports repeat them for every UV / normal seam)"""
    q = np.round((P - P.min(0)) / tol).astype(np.int64)
    key = (q[:, 0] * 1000003 + q[:, 1]) * 1000033 + q[:, 2]
    uk, first, inv = np.unique(key, return_index=True, return_inverse=True)
    T = inv[I]; T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    return P[first], T

def cluster(P, I, cell):
    mn = P.min(0); c = np.floor((P - mn) / cell).astype(np.int64)
    key = (c[:, 0] * 100003 + c[:, 1]) * 100019 + c[:, 2]
    uk, inv = np.unique(key, return_inverse=True); cnt = np.bincount(inv).astype(np.float64)
    NP = np.stack([np.bincount(inv, weights=P[:, k]) / cnt for k in range(3)], 1)
    T = inv[I]; T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    _, ui = np.unique(np.sort(T, axis=1), axis=0, return_index=True); return NP, T[np.sort(ui)]

def normals(P, T):
    n = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); N = np.zeros_like(P)
    for k in range(3): np.add.at(N, T[:, k], n)
    l = np.linalg.norm(N, axis=1, keepdims=True); l[l == 0] = 1; return N / l

def write(path, P, T, N, extras):
    P = P.astype('<f4'); N = N.astype('<f4'); T = T.astype('<u4').reshape(-1)
    ib, pb, nb = T.tobytes(), P.tobytes(), N.tobytes(); blob = ib + pb + nb
    blob += b'\0' * (-len(blob) % 4)
    J = {'asset': {'version': '2.0', 'generator': 'care-anatomy-sdk optimize_glb.py', 'extras': extras},
         'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'body'}],
         'meshes': [{'name': 'body', 'primitives': [{'attributes': {'POSITION': 1, 'NORMAL': 2}, 'indices': 0, 'material': 0}]}],
         'materials': [{'name': 'body', 'doubleSided': True, 'pbrMetallicRoughness': {'metallicFactor': 0.0, 'roughnessFactor': 0.6}}],
         'accessors': [{'bufferView': 0, 'componentType': 5125, 'count': len(T), 'type': 'SCALAR'},
                       {'bufferView': 1, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
                       {'bufferView': 2, 'componentType': 5126, 'count': len(N), 'type': 'VEC3'}],
         'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(ib), 'target': 34963},
                         {'buffer': 0, 'byteOffset': len(ib), 'byteLength': len(pb), 'target': 34962},
                         {'buffer': 0, 'byteOffset': len(ib) + len(pb), 'byteLength': len(nb), 'target': 34962}],
         'buffers': [{'byteLength': len(blob)}]}
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
    open(path, 'wb').write(out)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--cell', type=float, default=0.00285); ap.add_argument('--scale', type=float, nargs=3, default=[1, 1, 1]); ap.add_argument('--up-axis', choices=['y', 'z'], default='z', help='source model up axis (default: z)')
    a = ap.parse_args()
    J, bo, d = load(a.src); P, I = gather(J, bo, d, a.scale, a.up_axis)
    H = P[:, 1].max() - P[:, 1].min()
    print('source: %d vertices, %d triangles, height %.3f' % (len(P), len(I), H))
    NP, T = weld(P, I, H * 1e-6)
    if a.cell > 0: NP, T = cluster(NP, T, a.cell * H)
    N = normals(NP, T)
    used = np.unique(T); remap = -np.ones(len(NP), np.int64); remap[used] = np.arange(len(used)); NP, N, T = NP[used], N[used], remap[T]
    ex = dict(J.get('asset', {}).get('extras', {})); ex['optimized'] = 'static mesh, welded%s%s; source up-axis=%s by care-anatomy-sdk tools/optimize_glb.py' % (', vertex-clustered (cell=%g x height)' % a.cell if a.cell > 0 else '', ', per-axis correction x%g y%g z%g baked in' % tuple(a.scale) if list(a.scale) != [1, 1, 1] else '', a.up_axis)
    write(a.dst, NP, T, N, ex)
    print('output: %d vertices, %d triangles -> %s' % (len(NP), len(T), a.dst))
