import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimplexNoise, hashSeed, hash2, hash3, mulberry32 } from '../js/noise.js';

test('same seed gives identical noise', () => {
  const a = new SimplexNoise(1234);
  const b = new SimplexNoise(1234);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.noise2D(i * 0.37, i * 0.11), b.noise2D(i * 0.37, i * 0.11));
    assert.equal(a.noise3D(i * 0.2, i * 0.5, -i * 0.3), b.noise3D(i * 0.2, i * 0.5, -i * 0.3));
  }
});

test('different seeds give different noise', () => {
  const a = new SimplexNoise(1);
  const b = new SimplexNoise(2);
  let same = 0;
  for (let i = 0; i < 50; i++) if (a.noise2D(i * 0.7, 3.1) === b.noise2D(i * 0.7, 3.1)) same++;
  assert.ok(same < 5);
});

test('noise stays roughly within [-1, 1]', () => {
  const n = new SimplexNoise(99);
  for (let i = 0; i < 2000; i++) {
    const v2 = n.noise2D(i * 0.173, i * 0.091);
    const v3 = n.noise3D(i * 0.13, i * 0.07, i * 0.29);
    assert.ok(v2 >= -1.01 && v2 <= 1.01, `noise2D out of range: ${v2}`);
    assert.ok(v3 >= -1.01 && v3 <= 1.01, `noise3D out of range: ${v3}`);
  }
});

test('hashes are deterministic and in [0, 1)', () => {
  assert.equal(hashSeed('demo'), hashSeed('demo'));
  assert.notEqual(hashSeed('demo'), hashSeed('Demo'));
  for (let i = -50; i < 50; i++) {
    const h2 = hash2(i, -i * 3, 7);
    const h3 = hash3(i, i * 2, -i, 7);
    assert.ok(h2 >= 0 && h2 < 1);
    assert.ok(h3 >= 0 && h3 < 1);
    assert.equal(h2, hash2(i, -i * 3, 7));
  }
  const r1 = mulberry32(5);
  const r2 = mulberry32(5);
  for (let i = 0; i < 10; i++) assert.equal(r1(), r2());
});
