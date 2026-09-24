import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, MAX_STACK, INVENTORY_SIZE } from '../js/inventory.js';
import { MAT } from '../js/materials.js';

test('adding items fills existing stacks before empty slots', () => {
  const inv = new Inventory();
  inv.slots[3] = { id: MAT.DIRT, count: 60 };
  assert.equal(inv.add(MAT.DIRT, 10), 0);
  assert.deepEqual(inv.slots[3], { id: MAT.DIRT, count: MAX_STACK });
  assert.deepEqual(inv.slots[0], { id: MAT.DIRT, count: 6 });
});

test('a full inventory returns the leftover count', () => {
  const inv = new Inventory();
  for (let i = 0; i < INVENTORY_SIZE; i++) inv.slots[i] = { id: MAT.STONE, count: MAX_STACK };
  assert.equal(inv.add(MAT.SAND, 5), 5);
});

test('consuming the last item empties the slot', () => {
  const inv = new Inventory();
  inv.slots[0] = { id: MAT.TORCH, count: 1 };
  inv.consumeSelected();
  assert.equal(inv.slots[0], null);
});

test('clicking slots picks up, swaps, merges and splits stacks', () => {
  const inv = new Inventory();
  inv.slots[0] = { id: MAT.LOG, count: 10 };
  inv.slots[1] = { id: MAT.LOG, count: 5 };
  inv.slots[2] = { id: MAT.SAND, count: 3 };

  let cursor = inv.clickSlot(0, null); // pick up 10 logs
  assert.deepEqual(cursor, { id: MAT.LOG, count: 10 });
  cursor = inv.clickSlot(1, cursor); // merge into 5 logs
  assert.equal(cursor, null);
  assert.equal(inv.slots[1].count, 15);

  cursor = inv.clickSlot(1, null, true); // right-click takes half (rounded up)
  assert.equal(cursor.count, 8);
  assert.equal(inv.slots[1].count, 7);

  cursor = inv.clickSlot(2, cursor); // different item: swap
  assert.deepEqual(cursor, { id: MAT.SAND, count: 3 });
  assert.deepEqual(inv.slots[2], { id: MAT.LOG, count: 8 });
});
