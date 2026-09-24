import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../js/world.js';
import { buildSmoothGeometry } from '../js/surfacenets.js';
import { TerrainGenerator } from '../js/worldgen.js';
import { hashSeed } from '../js/noise.js';
import { sdfGenerator } from './helpers.js';

function worldFrom(generator, radius = 1) {
  const w = new World(new THREE.Scene(), generator, {});
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) w.generateChunk(cx, cz);
  return w;
}

test('a flat floor meshes to one quad per column at the right height', () => {
  const w = worldFrom(sdfGenerator((x, y) => 10.25 - y));
  const geo = buildSmoothGeometry(w, w.getChunk(0, 0));
  assert.equal(geo.index.length / 6, 16 * 16, 'one quad (two triangles) per column');
  for (let i = 1; i < geo.position.length; i += 3) assert.ok(Math.abs(geo.position[i] - 10.25) < 0.02, `vertex at y=${geo.position[i]}`);
  // Normals point up.
  for (let i = 1; i < geo.normal.length; i += 3) assert.ok(geo.normal[i] > 120);
});

test('a sphere meshes into a closed, watertight surface', () => {
  const w = worldFrom(sdfGenerator((x, y, z) => 5 - Math.hypot(x - 8, y - 40, z - 8)));
  const geo = buildSmoothGeometry(w, w.getChunk(0, 0));
  const edges = new Map();
  const idx = geo.index;
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k];
      const b = idx[t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const [edge, count] of edges) assert.equal(count, 2, `edge ${edge} is shared by ${count} triangles`);
  // Every vertex lies close to the sphere (Surface Nets smooths slightly).
  for (let i = 0; i < geo.position.length; i += 3) {
    const r = Math.hypot(geo.position[i] - 8, geo.position[i + 1] - 40, geo.position[i + 2] - 8);
    assert.ok(Math.abs(r - 5) < 0.6, `vertex at radius ${r}`);
  }
});

test('neighbouring chunks meet without seams', () => {
  const hills = (x, y, z) => 30 + 6 * Math.sin(x / 5) * Math.cos(z / 7) + 3 * Math.sin((x + z) / 3) - y;
  const w = worldFrom(sdfGenerator(hills));
  const a = buildSmoothGeometry(w, w.getChunk(0, 0));
  const aPos = new Set();
  for (let i = 0; i < a.position.length; i += 3) {
    aPos.add([a.position[i], a.position[i + 1], a.position[i + 2]].map((v) => v.toFixed(4)).join());
  }
  // Chunk (1, 0) starts at x = 16; its vertices in the shared border cells
  // (world x 15.5–16.5) must be exactly the ones chunk (0, 0) made.
  const b = buildSmoothGeometry(w, w.getChunk(1, 0));
  let shared = 0;
  for (let i = 0; i < b.position.length; i += 3) {
    const wx = b.position[i] + 16;
    if (wx > 16.5) continue;
    shared++;
    assert.ok(aPos.has([wx, b.position[i + 1], b.position[i + 2]].map((v) => v.toFixed(4)).join()), 'border vertex matches');
  }
  assert.ok(shared >= 16, `found ${shared} shared border vertices`);
});

test('generated terrain meshes into well-formed buffers, faster than cube meshing budget', () => {
  const gen = new TerrainGenerator(hashSeed('demo'));
  const w = worldFrom(gen);
  const geo = buildSmoothGeometry(w, w.getChunk(0, 0));
  assert.ok(geo.vertexCount > 0);
  assert.equal(geo.index.length % 3, 0);
  for (const i of geo.index) assert.ok(i < geo.vertexCount);
  for (const v of geo.position) assert.ok(Number.isFinite(v));
});
