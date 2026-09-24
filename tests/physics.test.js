import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveEntity, intersectsBlock } from '../js/physics.js';

// Minimal world: solid below y = 5, plus a wall at x = 10.
const world = {
  isSolid: (x, y) => y < 5 || x === 10,
  getMaterial: () => 0,
};

function entity(x, y, z) {
  const v = (a, b, c) => ({ x: a, y: b, z: c });
  return { position: v(x, y, z), velocity: v(0, 0, 0), width: 0.6, height: 1.8 };
}

test('a falling entity lands on the ground', () => {
  const e = entity(2.5, 9, 2.5);
  for (let i = 0; i < 120; i++) {
    e.velocity.y -= 28 / 60;
    moveEntity(world, e, 1 / 60);
  }
  assert.ok(Math.abs(e.position.y - 5) < 0.01, `landed at ${e.position.y}`);
  assert.equal(e.onGround, true);
  assert.equal(e.velocity.y, 0);
});

test('walls stop horizontal movement', () => {
  const e = entity(8.5, 5, 2.5);
  for (let i = 0; i < 60; i++) {
    e.velocity.x = 5; // keep walking into the wall, as a mob or player would
    moveEntity(world, e, 1 / 60);
  }
  assert.ok(e.position.x + e.width / 2 <= 10, `passed through the wall at x=${e.position.x}`);
  assert.equal(e.hitWall, true);
});

test('fast movement does not tunnel through a wall', () => {
  const e = entity(8.5, 5, 2.5);
  e.velocity.x = 200; // 3.3 blocks in one frame
  moveEntity(world, e, 1 / 60);
  assert.ok(e.position.x < 10);
});

test('intersectsBlock detects overlap with a cell', () => {
  const e = entity(2.5, 5, 2.5);
  assert.equal(intersectsBlock(e, 2, 5, 2), true);
  assert.equal(intersectsBlock(e, 2, 7, 2), false);
  assert.equal(intersectsBlock(e, 4, 5, 2), false);
});
