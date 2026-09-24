import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../js/world.js';
import { moveEntity, groundBelow } from '../js/physics.js';
import { MAT } from '../js/materials.js';
import { sdfGenerator } from './helpers.js';

function worldFrom(f, radius = 3) {
  const w = new World(new THREE.Scene(), sdfGenerator(f), {});
  w.smoothTerrain = true;
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) w.generateChunk(cx, cz);
  return w;
}

function entity(x, y, z) {
  return { position: new THREE.Vector3(x, y, z), velocity: new THREE.Vector3(), width: 0.6, height: 1.8 };
}

/** Runs `seconds` of physics at 60 Hz, walking with the given horizontal velocity. */
function simulate(w, e, seconds, vx = 0, vz = 0) {
  for (let i = 0; i < seconds * 60; i++) {
    e.velocity.x = vx;
    e.velocity.z = vz;
    e.velocity.y -= 28 / 60;
    moveEntity(w, e, 1 / 60);
  }
}

test('the ground height is found between cell centres', () => {
  const w = worldFrom((x, y) => 10.3 - y, 1);
  // Density is stored in 1/32 m steps, so heights are accurate to ~1–2 cm.
  assert.ok(Math.abs(groundBelow(w, 3.2, 4.7, 14, 5) - 10.3) < 0.03);
  assert.equal(groundBelow(w, 3, 3, 9, 2), Infinity, 'starting inside the ground');
  assert.equal(groundBelow(w, 3, 3, 30, 12), -Infinity, 'no ground in range');
});

test('an entity lands on and rests on a smooth floor', () => {
  const w = worldFrom((x, y) => 10.3 - y);
  const e = entity(2.5, 14, 2.5);
  simulate(w, e, 2);
  assert.ok(Math.abs(e.position.y - 10.3) < 0.02, `resting at ${e.position.y}`);
  assert.equal(e.onGround, true);
});

test('walking up a 27° slope climbs smoothly without jumping', () => {
  const slope = (x, y) => 20 + 0.5 * x - y;
  const w = worldFrom(slope);
  const e = entity(-10, 16, 0.5);
  simulate(w, e, 0.5); // settle
  simulate(w, e, 3, 4, 0);
  assert.ok(e.position.x > 0, `walked to x=${e.position.x}`);
  const ground = 20 + 0.5 * e.position.x;
  assert.ok(Math.abs(e.position.y - ground) < 0.35, `feet ${e.position.y} vs ground ${ground}`);
});

test('walking down a slope keeps the entity on the ground', () => {
  const w = worldFrom((x, y) => 20 + 0.5 * x - y);
  const e = entity(8, 25, 0.5);
  simulate(w, e, 0.5);
  let airborne = 0;
  for (let i = 0; i < 120; i++) {
    simulate(w, e, 1 / 60, -4, 0);
    if (!e.onGround) airborne++;
  }
  assert.ok(airborne <= 2, `airborne on ${airborne} of 120 frames`);
});

test('a cliff stops the entity', () => {
  const cliff = (x, y) => (x < 5 ? 10 : 25) - y;
  const w = worldFrom(cliff);
  const e = entity(0.5, 11, 0.5);
  simulate(w, e, 2, 4, 0);
  assert.ok(e.position.x < 5, `stopped at x=${e.position.x}`);
  assert.ok(e.position.y < 11, 'did not climb the cliff');
  assert.equal(e.hitWall, true);
});

test('a small ledge is stepped up without jumping', () => {
  const ledge = (x, y) => (x < 5 ? 10 : 10.45) - y;
  const w = worldFrom(ledge);
  const e = entity(0.5, 11, 0.5);
  simulate(w, e, 2, 4, 0);
  assert.ok(e.position.x > 6, `walked to x=${e.position.x}`);
  assert.ok(Math.abs(e.position.y - 10.45) < 0.05);
});

test('legacy blocks still collide as boxes', () => {
  const w = worldFrom((x, y) => 10 - y);
  for (let y = 10; y < 13; y++) w.setMaterial(5, y, 0, MAT.PLANKS);
  const e = entity(2.5, 10.2, 0.5);
  simulate(w, e, 2, 4, 0);
  assert.ok(e.position.x + 0.3 <= 5.01, `stopped at x=${e.position.x}`);
});
