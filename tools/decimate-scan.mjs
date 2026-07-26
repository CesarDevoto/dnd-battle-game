// cot.glb is a 519 MB photogrammetry export: 4.68M triangles and 14M vertices, i.e.
// ~3 verts per triangle — NOTHING is shared, every face carries its own normals, so both
// weld (bitwise) and simplify are no-ops on it.
//
// Fix: drop the per-face NORMAL attribute so weld can merge by position+UV, which restores
// real topology, then simplify hard, then recompute smooth normals.
const G = 'file:///C:/Users/cdevo/AppData/Roaming/npm/node_modules/@gltf-transform/cli/node_modules/';
const { NodeIO } = await import(G + '@gltf-transform/core/dist/index.js');
const fns = await import(G + '@gltf-transform/functions/dist/index.js');
const { weld, simplify, normals, prune, dedup } = fns;
const { MeshoptSimplifier } = await import(G + 'meshoptimizer/meshopt_simplifier.js');

const [, , inPath, outPath, ratioArg] = process.argv;
const ratio = Number(ratioArg ?? 0.002);

const io = new NodeIO();
const doc = await io.read(inPath);
await MeshoptSimplifier.ready;

const count = () => doc.getRoot().listMeshes()
  .flatMap(m => m.listPrimitives())
  .reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);

console.log(`in:  ${Math.round(count())} tris`);

// Strip the seam-inducing attribute, then weld.
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
}
await doc.transform(dedup(), weld());
console.log(`welded: ${doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION').getCount()} verts`);

// Even after welding, verts ≈ triangles — the mesh is still ~2x the vertex count a connected
// manifold would have, because every UV seam splits a vertex. Bitwise weld can't cross that,
// and the simplifier can't collapse across it either. So: weld by POSITION ALONE, keeping the
// first UV seen at each position. Costs a little texture smearing along seams (invisible on a
// tactical-camera prop) and buys the topology the simplifier needs.
function weldByPosition(prim, tol = 0.0005) {
  const posAcc = prim.getAttribute('POSITION');
  const uvAcc  = prim.getAttribute('TEXCOORD_0');
  const idxAcc = prim.getIndices();
  const pos = posAcc.getArray(), uv = uvAcc?.getArray();
  const idx = idxAcc ? idxAcc.getArray() : null;
  const n = posAcc.getCount();

  // Numeric hash key: quantize to `tol` and pack 3 axes into one double (< 2^53).
  const S = 1 / tol, B = 2097152;   // 2^21 per axis
  const map = new Map();
  const remap = new Int32Array(n);
  const newPos = [], newUV = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const key = ((Math.round(x * S) + 1048576) * B + (Math.round(y * S) + 1048576)) * B
              + (Math.round(z * S) + 1048576);
    let dst = map.get(key);
    if (dst === undefined) {
      dst = newPos.length / 3;
      map.set(key, dst);
      newPos.push(x, y, z);
      if (uv) newUV.push(uv[i * 2], uv[i * 2 + 1]);
    }
    remap[i] = dst;
  }

  const srcIdx = idx ?? { length: n, [Symbol.iterator]: null };
  const count = idx ? idx.length : n;
  const outIdx = new Uint32Array(count);
  for (let i = 0; i < count; i++) outIdx[i] = remap[idx ? idx[i] : i];

  posAcc.setArray(new Float32Array(newPos));
  if (uvAcc) uvAcc.setArray(new Float32Array(newUV));
  if (idxAcc) idxAcc.setArray(outIdx);
  else prim.setIndices(doc.createAccessor().setArray(outIdx));
  return newPos.length / 3;
}

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    console.log(`position-weld: ${prim.getAttribute('POSITION').getCount()} → ${weldByPosition(prim)} verts`);
  }
}

// One simplify pass stalls well above target: the scan is full of tiny disconnected shells,
// so the simplifier runs out of legal collapses long before it runs out of error budget.
// Re-welding after each pass fuses shells whose vertices have just been snapped together,
// which unlocks the next round. Loop until it stops making progress or hits the target.
const TARGET = Number(process.env.TARGET_TRIS ?? 12000);
let prev = Infinity;
for (let i = 1; i <= 12; i++) {
  const before = count();
  if (before <= TARGET) break;
  // Re-weld by position EVERY pass, with a tolerance that grows as the mesh coarsens.
  // Collapsing moves vertices, so shells that were merely near each other become
  // coincident and can finally fuse — a bitwise weld here never catches that.
  const tol = Number(process.env.TOL ?? 0.0005) * Math.pow(1.8, i - 1);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) weldByPosition(prim, tol);
  }
  await doc.transform(
    simplify({ simplifier: MeshoptSimplifier, ratio, error: Number(process.env.ERR ?? 0.06), lockBorder: false }),
  );
  const after = count();
  console.log(`  pass ${i}: ${Math.round(before)} → ${Math.round(after)} tris`);
  if (after > before * 0.97) { console.log('  (plateaued)'); break; }   // <3% gain — done
  prev = after;
}
console.log(`simplified: ${Math.round(count())} tris`);

// Recompute normals — the originals were discarded to make welding possible.
await doc.transform(normals({ overwrite: true }), prune());

await io.write(outPath, doc);
console.log(`out: ${Math.round(count())} tris → ${outPath}`);
