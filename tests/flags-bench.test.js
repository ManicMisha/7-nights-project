import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFlags } from '../js/flags.js';
import { parseBenchOptions, summarizeFrames, routePoint, BENCH_DEFAULTS } from '../js/bench.js';

const registry = {
  alpha: { default: false, description: 'test flag' },
  beta: { default: true, description: 'test flag' },
};

test('flags use their defaults when the URL has none', () => {
  assert.deepEqual(resolveFlags('', registry), { flags: { alpha: false, beta: true }, unknown: [] });
});

test('flags can be switched on and off from the URL', () => {
  const { flags, unknown } = resolveFlags('?flags=alpha,-beta,nope', registry);
  assert.deepEqual(flags, { alpha: true, beta: false });
  assert.deepEqual(unknown, ['nope']);
});

test('bench options parse from the query string', () => {
  assert.equal(parseBenchOptions('?seed=x'), null);
  assert.deepEqual(parseBenchOptions('?bench'), BENCH_DEFAULTS);
  const o = parseBenchOptions('?bench=60&time=0.8');
  assert.equal(o.seconds, 60);
  assert.equal(o.time, 0.8);
  assert.equal(parseBenchOptions('?bench=abc').seconds, BENCH_DEFAULTS.seconds);
});

test('frame summary reports average and 1% low FPS', () => {
  const frames = new Array(99).fill(10).concat([100]); // one 100 ms hitch
  const s = summarizeFrames(frames);
  assert.equal(s.frames, 100);
  assert.equal(s.avgFps, 91.7); // 100 frames in 1090 ms, rounded to 0.1
  assert.equal(s.onePercentLowFps, 10);
  assert.equal(s.p50Ms, 10);
  assert.equal(s.maxMs, 100);
  assert.equal(summarizeFrames([]), null);
});

test('the benchmark route is a closed loop', () => {
  assert.deepEqual(routePoint(0), [0, 0]);
  assert.deepEqual(routePoint(80), [80, 0]);
  assert.deepEqual(routePoint(160 + 40), [160, 40]);
  assert.deepEqual(routePoint(640), [0, 0]);
});
