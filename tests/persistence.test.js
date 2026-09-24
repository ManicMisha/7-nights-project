import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorldId } from '../js/persistence.js';

const storageWith = (value) => ({ getItem: () => value });

test('?seed picks the world, then the last world played, then a random one', () => {
  assert.equal(resolveWorldId('?seed=abc', storageWith('last')), 'abc');
  assert.equal(resolveWorldId('', storageWith('last')), 'last');
  assert.equal(resolveWorldId('?bench', storageWith('last')), 'demo');
  const fresh = resolveWorldId('', storageWith(null));
  assert.match(fresh, /^\d+$/);
});
