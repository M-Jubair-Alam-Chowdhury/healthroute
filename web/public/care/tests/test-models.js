/* Dependency-free regression test: node tests/test-models.js */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'body-selector.js'));
require(path.join(root, 'models-inline.js'));
const api = globalThis.CareAnatomy;
class MockGroup { constructor() { this.children = []; this.scale = { setScalar(v) { this.value = v; } }; } add(v) { this.children.push(v); } }
class MockGeometry { constructor() { this.attributes = {}; } setAttribute(k, v) { this.attributes[k] = v; } setIndex(v) { this.index = v; } }
class MockAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
class MockMaterial { constructor(props) { Object.assign(this, props); } }
class MockColor { constructor(...v) { this.value = v; } set(...v) { this.value = v; } setHSL(...v) { this.value = v; } }
class MockMesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } }
const mockThree = { Group: MockGroup, BufferGeometry: MockGeometry, BufferAttribute: MockAttribute, MeshStandardMaterial: MockMaterial, Color: MockColor, Mesh: MockMesh, DoubleSide: 2, FrontSide: 1 };
const cases = [
  { sex: 'female', pose: '12', file: 'basic_human_female.glb', expectedMeshes: 1 },
  { sex: 'male', pose: '12', file: 'basic_male_model.glb', expectedMeshes: 1 },
];
function assert(condition, message) { if (!condition) throw new Error(message); }
async function main() {
  // Regression for the former majority-label shortcut: the tap is near vertex 3,
  // so its region must win even though vertices 1 and 2 share a different label.
  assert(api.dominantTriangleLabel([4, 4, 9], [0.04, 0.06, 0.90]) === 9, 'tap near third vertex must select its region, not the triangle majority');
  assert(api.dominantTriangleLabel([4, 9, 9], [0.82, 0.10, 0.08]) === 4, 'tap near first vertex must select its region');
for (const c of cases) {
  const embedded = globalThis.CARE_ANATOMY_EMBEDDED_GLB[c.sex];
  assert(typeof embedded === 'string' && embedded.length > 1000, `${c.sex}: embedded payload missing`);
  const decoded = Buffer.from(embedded, 'base64');
  const original = fs.readFileSync(path.join(root, 'models', c.file));
  assert(decoded.equals(original), `${c.sex}: embedded fallback differs from bundled GLB`);
  assert(decoded.readUInt32LE(0) === 0x46546c67, `${c.sex}: invalid GLB magic`);
  assert(decoded.readUInt32LE(4) === 2, `${c.sex}: expected glTF 2.0`);
  const ab = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength);
  for (let pass = 0; pass < 3; pass++) {
    const prepared = api.prepareGLB(ab, { sex: c.sex, pose: c.pose });
    assert(prepared.parts.length === c.expectedMeshes, `${c.sex}: unexpected mesh count`);
    assert(prepared.names.length > 50, `${c.sex}: too few selectable region labels`);
    let vertices = 0, labelled = 0;
    for (const part of prepared.parts) {
      assert(part.P.length > 0 && part.N.length === part.P.length, `${c.sex}: invalid geometry arrays`);
      vertices += part.labels.length;
      for (const label of part.labels) if (prepared.names[label]) labelled++;
    }
    const coverage = labelled / vertices;
    assert(coverage === 1, `${c.sex}: every vertex must be selectable; coverage (${coverage})`);
    // Orientation regression: top vertices must map to the head and bottom vertices to feet.
    let minY = Infinity, maxY = -Infinity;
    for (const part of prepared.parts) for (let i = 1; i < part.P.length; i += 3) { minY = Math.min(minY, part.P[i]); maxY = Math.max(maxY, part.P[i]); }
    const top = new Set(), bottom = new Set();
    for (const part of prepared.parts) for (let i = 0; i < part.labels.length; i++) {
      const y = part.P[i * 3 + 1], id = prepared.names[part.labels[i]] || '';
      if (y > maxY - 24) top.add(id);
      if (y < minY + 24) bottom.add(id);
    }
    assert([...top].some(id => /head|scalp|forehead/.test(id)), `${c.sex}: uppermost geometry must be labelled as head`);
    assert([...bottom].some(id => /foot|heel|toe/.test(id)), `${c.sex}: lowermost geometry must be labelled as foot`);
    // Test the actual point picker (the same lookup used for a tap), not only
    // whether every vertex happened to receive some label.
    assert(/head|scalp|forehead|nose/.test(prepared.regionAtPoint(0, 580, 0.1) || ''), `${c.sex}: tap at top centre must resolve to head`);
    assert(/foot|heel|toe|ankle/.test(prepared.regionAtPoint(0, 8, 0.1) || ''), `${c.sex}: tap at bottom centre must resolve to foot/ankle`);
    assert(/sternum|chest|breast/.test(prepared.regionAtPoint(0, 400, 0.1) || ''), `${c.sex}: front torso tap must resolve to chest`);
    assert(/back/.test(prepared.regionAtPoint(0, 400, -0.1) || ''), `${c.sex}: back torso tap must resolve to back`);
    assert(prepared.regionAtPoint(60, 300, 0.1) !== prepared.regionAtPoint(-60, 300, 0.1), `${c.sex}: left/right hip taps must resolve to different sides`);
    // Face / arm landmark regression (the former "tap the mouth, get the chin" bug)
    const F = c.sex === 'female' ? { eye: 538, mouth: 516, chin: 503, nose: 527 } : { eye: 545, mouth: 519, chin: 508, nose: 533 };
    const at = (x, y, z) => prepared.regionAtPoint(x, y, z) || '';
    assert(/eye/.test(at(10, F.eye, 30)), `${c.sex}: eye tap must resolve to an eye (got ${at(10, F.eye, 30)})`);
    assert(at(0, F.mouth, 30) === 'mouth', `${c.sex}: mouth tap must resolve to mouth (got ${at(0, F.mouth, 30)})`);
    assert(at(0, F.chin, 30) === 'chin', `${c.sex}: chin tap must resolve to chin (got ${at(0, F.chin, 30)})`);
    assert(at(0, F.nose, 30) === 'nose', `${c.sex}: nose tap must resolve to nose (got ${at(0, F.nose, 30)})`);
    assert(at(0, 560, 30) === 'forehead', `${c.sex}: forehead tap must resolve to forehead (got ${at(0, 560, 30)})`);
    const hand = c.sex === 'female' ? [98, 262] : [146, 262], elbow = c.sex === 'female' ? [92, 372] : [110, 355];
    assert(/hand/.test(at(hand[0], hand[1], 5)) && /hand/.test(at(-hand[0], hand[1], 5)), `${c.sex}: hand taps must resolve to the hand (got ${at(hand[0], hand[1], 5)})`);
    assert(/elbow/.test(at(elbow[0], elbow[1], 5)), `${c.sex}: elbow tap must resolve to the elbow (got ${at(elbow[0], elbow[1], 5)})`);
    console.log(`${c.sex} pass ${pass + 1}: GLB valid; upright head-to-foot axis; real-point picker head/chest/back/feet/left-right tests; ${prepared.parts.length} mesh(es); ${vertices.toLocaleString()} vertices; ${prepared.names.length - 1} region labels; ${(coverage * 100).toFixed(2)}% vertices mapped`);
  }
  const built = await api.buildGLB(mockThree, ab, { sex: c.sex, pose: c.pose });
  assert(built.meshes.length === c.expectedMeshes, `${c.sex}: mesh assembly failed`);
  assert(built.regionVerts.size >= 50, `${c.sex}: interactive region map not built`);
  assert(built.pick.length === c.expectedMeshes, `${c.sex}: hit-test meshes missing`);
  console.log(`${c.sex} scene assembly: ${built.meshes.length} pickable mesh(es), ${built.regionVerts.size} selectable region IDs`);
  console.log(`${c.sex} SHA-256: ${crypto.createHash('sha256').update(decoded).digest('hex')}`);
}
console.log('PASS: both bundled GLBs and embedded fallbacks validated across repeated geometry builds.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
