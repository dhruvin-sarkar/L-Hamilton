/**
 * Bake public/assets/helmet/helmet.glb down to what the site draws.
 *
 * The supplied model carries two liveries. Its own 300-odd flat-coloured decal
 * meshes make a purple one; underneath them, the bare shell (`__DEFAULT`) is
 * UV-mapped to the black-and-gold sheet supplied with it, and the fins
 * (`ALETTE`) to its wing sheet. The black and gold is the one drawn, so only the
 * shell, the fins and the parts both liveries share are kept: visor, seals,
 * vents and the visor pivots. Everything else is the purple decal layer.
 *
 * This used to happen in the browser on every load: 470 Draco meshes decoded,
 * about 440 of them thrown away, and the rest cloned and merged by material on
 * the main thread. Now it happens here, once, and the file ships as the merged
 * result -- one mesh per distinct material, in the order the runtime used to
 * build them, so HelmetModel only has to put its own materials on them.
 *
 * The merge is the runtime's, exactly: parts in scene order, grouped by the key
 * HelmetModel used (flat colour, opacity, livery sheet), vertices concatenated
 * and indices offset. Every part sits at an identity transform, which is
 * asserted rather than assumed -- the runtime baked world matrices in, and a
 * part that ever carried one would need that done here too.
 *
 * Compression is Draco, which the site already decodes, at the precision the
 * source file was encoded with: 14-bit positions, 10-bit normals, 12-bit UVs.
 * Coarser would get the file under 400 KB (12-bit positions and 9-bit normals
 * land at 384 KB) but moves the clearcoat's reflections, which are the whole
 * surface of this helmet; at the source's precision the re-encode moves no
 * vertex by more than a hundredth of a pixel. Opaque parts use edgebreaker, at
 * its slowest and smallest; it re-orders triangles, which the depth test makes
 * invisible. The see-through visor does not get that pass: its overlapping
 * triangles blend in draw order, so it is re-encoded with sequential
 * connectivity, which keeps the order, and spliced back in (see the end of this
 * file). Checked against the old runtime merge, rendered from the same poses.
 *
 * Only the shell and the fins keep their UVs. Every other part is a flat
 * colour, whose material never reads them.
 *
 * Needs @gltf-transform/core, /extensions, /functions (v4) and draco3dgltf,
 * which are not dependencies of the site. Install them anywhere and point
 * GLTF_TOOLS at that folder:
 *
 *   npm i --prefix <dir> @gltf-transform/core@4 @gltf-transform/extensions@4 \
 *     @gltf-transform/functions@4 draco3dgltf
 *   GLTF_TOOLS=<dir> node tools/bake-helmet.mjs <source.glb> public/assets/helmet/helmet.glb
 *
 * The source is the helmet as it was before this bake, the 470-mesh file:
 *   git show 16748c0:app/public/assets/helmet/helmet.glb > helmet-source.glb
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: node tools/bake-helmet.mjs <source.glb> <output.glb>');
if (!process.env.GLTF_TOOLS) throw new Error('set GLTF_TOOLS to a folder with the glTF-Transform packages installed');

const requireTools = createRequire(path.join(path.resolve(process.env.GLTF_TOOLS), 'noop.js'));
const load = async (name) => import(pathToFileURL(requireTools.resolve(name)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { KHRDracoMeshCompression } = await load('@gltf-transform/extensions');
const { draco, prune } = await load('@gltf-transform/functions');
const draco3d = (await load('draco3dgltf')).default;

/** The black-and-gold livery's two painted sheets, by material name. */
const SHEETS = new Set(['__DEFAULT', 'ALETTE']);

/** Parts both liveries share. Everything else is the purple decal layer. */
const SHARED_PARTS = new Set([
  'Nuovo materiale 001', // the visor
  'NERO GUARNIZ', // visor and neck seals
  'NERO PLATIC', // vents
  'ORO', // visor pivot hardware
  'GRIG METALLO',
  'VIOLA METALLO',
]);

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(source);
const root = doc.getRoot();

/* The runtime keyed its buckets on three's view of the material: the base
   colour as an sRGB hex, the opacity (1 for a painted sheet, whatever the flat
   colour says otherwise), and which sheet. Reproduced so the grouping is the
   same, not merely similar. */
const toSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * c ** 0.41666 - 0.055);
const hex = ([r, g, b]) =>
  [r, g, b].map((c) => Math.round(Math.min(Math.max(toSrgb(c), 0), 1) * 255).toString(16).padStart(2, '0')).join('');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const buckets = new Map();

/** Depth-first, parent before children: the order GLTFLoader's scene traverses in. */
const visit = (node) => {
  const mesh = node.getMesh();
  if (mesh) {
    const world = node.getWorldMatrix();
    if (world.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-12)) {
      throw new Error(`"${node.getName()}" is not at the identity transform; bake its matrix in first`);
    }
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const name = material?.getName() ?? '';
      const sheet = SHEETS.has(name);
      if (!sheet && !SHARED_PARTS.has(name)) continue; // the purple decal layer
      const factor = material.getBaseColorFactor();
      const key = `${hex(factor)}|${sheet ? 1 : factor[3]}|${sheet ? name : '-'}`;
      if (!buckets.has(key)) buckets.set(key, { material, parts: [] });
      buckets.get(key).parts.push(prim);
    }
  }
  for (const child of node.listChildren()) visit(child);
};
for (const scene of root.listScenes()) for (const node of scene.listChildren()) visit(node);

/* Concatenate each bucket, as BufferGeometryUtils.mergeGeometries did. The
   normals are renormalised on the way through, which is what applyMatrix4 did
   to them even at identity. */
const buffer = root.listBuffers()[0];
const scene = doc.createScene('helmet');
root.setDefaultScene(scene);
const SEMANTICS = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

/** See-through buckets, by name, with the geometry they were built from. */
const seeThrough = new Map();

for (const { material, parts } of buckets.values()) {
  const count = parts.reduce((n, p) => n + p.getAttribute('POSITION').getCount(), 0);
  const arrays = {
    POSITION: new Float32Array(count * 3),
    NORMAL: new Float32Array(count * 3),
    TEXCOORD_0: new Float32Array(count * 2),
  };
  const indices = [];
  let offset = 0;
  for (const prim of parts) {
    const semantics = prim.listSemantics().slice().sort().join();
    if (semantics !== SEMANTICS.slice().sort().join() || !prim.getIndices() || prim.getMode() !== 4) {
      throw new Error(`[helmet] "${material.getName()}" part has ${semantics}, not indexed ${SEMANTICS.join()} triangles`);
    }
    for (const semantic of SEMANTICS) {
      const src = prim.getAttribute(semantic).getArray();
      arrays[semantic].set(src, offset * (semantic === 'TEXCOORD_0' ? 2 : 3));
    }
    for (const i of prim.getIndices().getArray()) indices.push(i + offset);
    offset += prim.getAttribute('POSITION').getCount();
  }
  const n = arrays.NORMAL;
  for (let i = 0; i < n.length; i += 3) {
    const length = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
    n[i] /= length;
    n[i + 1] /= length;
    n[i + 2] /= length;
  }

  const prim = doc.createPrimitive().setMaterial(material);
  prim.setIndices(
    doc.createAccessor().setType('SCALAR').setBuffer(buffer)
      .setArray(count > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices)),
  );
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(arrays.POSITION));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(arrays.NORMAL));
  const name = material.getName();
  /* UVs only where a livery sheet is sampled through them. Every other part is
     a flat colour, and a material without a map never reads its UVs -- they
     were most of the file's texcoord data and none of what is drawn. */
  if (SHEETS.has(name)) {
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(arrays.TEXCOORD_0));
  }
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  // The runtime's rule: flat-coloured and not fully opaque is drawn blended.
  if (!SHEETS.has(name) && material.getBaseColorFactor()[3] < 1) {
    seeThrough.set(name, { positions: arrays.POSITION, normals: arrays.NORMAL, indices: Uint32Array.from(indices) });
  }
}

/* Drop the source scene, then everything only it reached: the decal layer, its
   materials, and the 470 original meshes. (The source's KHR_materials_ior is
   not registered above, so it is not read at all: the site builds its own
   materials and only takes the name, colour and opacity from these.) */
for (const old of root.listScenes()) if (old !== scene) old.dispose();

await doc.transform(
  // keepAttributes: these materials carry no textures (the site applies its
  // sheets by name), so prune would otherwise strip the UVs the sheets need.
  prune({ keepAttributes: true }),
  draco({
    method: 'edgebreaker',
    quantizePosition: 14,
    quantizeNormal: 10,
    quantizeTexcoord: 12,
    encodeSpeed: 0,
    decodeSpeed: 0,
  }),
);

/* Edgebreaker, used above for its size, re-orders triangles as it walks the
   mesh. That is invisible on an opaque part, where the depth test decides
   every pixel, and not on a blended one: the visor overlaps itself, and which
   of its triangles blends over which is part of how it looks. So each
   see-through part is encoded again with SEQUENTIAL connectivity, which keeps
   triangle order, and swapped into the file in place of its edgebreaker copy. */
const glb = await io.writeBinary(doc);
const encoderModule = await draco3d.createEncoderModule();

const encodeInOrder = ({ positions, normals, indices }) => {
  const builder = new encoderModule.MeshBuilder();
  const mesh = new encoderModule.Mesh();
  const encoder = new encoderModule.ExpertEncoder(mesh);
  const out = new encoderModule.DracoInt8Array();
  const count = positions.length / 3;
  const ids = {
    POSITION: builder.AddFloatAttribute(mesh, encoderModule.POSITION, count, 3, positions),
    NORMAL: builder.AddFloatAttribute(mesh, encoderModule.NORMAL, count, 3, normals),
  };
  encoder.SetAttributeQuantization(ids.POSITION, 14);
  encoder.SetAttributeQuantization(ids.NORMAL, 10);
  builder.AddFacesToMesh(mesh, indices.length / 3, indices);
  encoder.SetSpeedOptions(0, 0);
  encoder.SetTrackEncodedProperties(true); // for the point and face counts below
  encoder.SetEncodingMethod(encoderModule.MESH_SEQUENTIAL_ENCODING);
  const length = encoder.EncodeToDracoBuffer(true, out);
  if (length <= 0) throw new Error('[helmet] sequential Draco encode failed');
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = out.GetValue(i);
  const encoded = { data, ids, points: encoder.GetNumberOfEncodedPoints(), faces: encoder.GetNumberOfEncodedFaces() };
  for (const object of [out, encoder, mesh, builder]) encoderModule.destroy(object);
  return encoded;
};

const chunks = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
const jsonLength = chunks.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart, binStart + chunks.getUint32(20 + jsonLength, true));
const replaced = new Map();
for (const [name, geometry] of seeThrough) {
  const primitive = json.meshes.find((m) => m.name === name).primitives[0];
  const compressed = primitive.extensions.KHR_draco_mesh_compression;
  const encoded = encodeInOrder(geometry);
  if (encoded.faces * 3 !== geometry.indices.length) throw new Error(`[helmet] "${name}" lost triangles`);
  replaced.set(compressed.bufferView, encoded.data);
  compressed.attributes = encoded.ids;
  json.accessors[primitive.indices].count = encoded.faces * 3;
  for (const accessor of Object.values(primitive.attributes)) json.accessors[accessor].count = encoded.points;
}

/* Re-lay the binary chunk around the swapped views, 4-byte aligned. */
const pad4 = (n) => (n + 3) & ~3;
const pieces = json.bufferViews.map(
  (view, index) => replaced.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength),
);
let cursor = 0;
json.bufferViews.forEach((view, index) => {
  view.byteOffset = cursor;
  view.byteLength = pieces[index].length;
  cursor = pad4(cursor + view.byteLength);
});
json.buffers[0].byteLength = cursor;
const binOut = new Uint8Array(cursor);
json.bufferViews.forEach((view, index) => binOut.set(pieces[index], view.byteOffset));
const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonOut = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
jsonOut.set(jsonBytes);

const file = new Uint8Array(20 + jsonOut.length + 8 + binOut.length);
const header = new DataView(file.buffer);
header.setUint32(0, 0x46546c67, true); // "glTF"
header.setUint32(4, 2, true);
header.setUint32(8, file.length, true);
header.setUint32(12, jsonOut.length, true);
header.setUint32(16, 0x4e4f534a, true); // "JSON"
file.set(jsonOut, 20);
header.setUint32(20 + jsonOut.length, binOut.length, true);
header.setUint32(24 + jsonOut.length, 0x004e4942, true); // "BIN"
file.set(binOut, 28 + jsonOut.length);
writeFileSync(output, file);

const summary = json.meshes.map(({ name, primitives: [primitive] }) => {
  const { attributes, indices, extensions } = primitive;
  const draw = replaced.has(extensions.KHR_draco_mesh_compression.bufferView) ? 'sequential' : 'edgebreaker';
  return `${name}: ${json.accessors[attributes.POSITION].count} vertices, ${json.accessors[indices].count / 3} triangles, ${Object.keys(attributes).join(' ')}, ${draw}`;
});
console.log(`${summary.join('\n')}\n${output}: ${file.length} bytes`);
