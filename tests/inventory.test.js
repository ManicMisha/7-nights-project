import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, MAX_STACK, INVENTORY_SIZE } from '../js/inventory.js';
import { ITEM } from '../js/items.js';

test('adding items fills existing stacks before empty slots', () => {
  const inv = new Inventory();
  inv.slots[3] = { id: ITEM.DIRT, count: 60 };
  assert.equal(inv.add(ITEM.DIRT, 10), 0);
  assert.deepEqual(inv.slots[3], { id: ITEM.DIRT, count: MAX_STACK });
  assert.deepEqual(inv.slots[0], { id: ITEM.DIRT, count: 6 });
});

test('a full inventory returns the leftover count', () => {
  const inv = new Inventory();
  for (let i = 0; i < INVENTORY_SIZE; i++) inv.slots[i] = { id: ITEM.STONE, count: MAX_STACK };
  assert.equal(inv.add(ITEM.SAND, 5), 5);
});

test('consuming the last item empties the slot', () => {
  const inv = new Inventory();
  inv.slots[0] = { id: ITEM.TORCH, count: 1 };
  inv.consumeSelected();
  assert.equal(inv.slots[0], null);
});

test('clicking slots picks up, swaps, merges and splits stacks', () => {
  const inv = new Inventory();
  inv.slots[0] = { id: ITEM.LOG, count: 10 };
  inv.slots[1] = { id: ITEM.LOG, count: 5 };
  inv.slots[2] = { id: ITEM.SAND, count: 3 };

  let cursor = inv.clickSlot(0, null); // pick up 10 logs
  assert.deepEqual(cursor, { id: ITEM.LOG, count: 10 });
  cursor = inv.clickSlot(1, cursor); // merge into 5 logs
  assert.equal(cursor, null);
  assert.equal(inv.slots[1].count, 15);

  cursor = inv.clickSlot(1, null, true); // right-click takes half (rounded up)
  assert.equal(cursor.count, 8);
  assert.equal(inv.slots[1].count, 7);

  cursor = inv.clickSlot(2, cursor); // different item: swap
  assert.deepEqual(cursor, { id: ITEM.SAND, count: 3 });
  assert.deepEqual(inv.slots[2], { id: ITEM.LOG, count: 8 });
});

test('the inventory saves and restores, dropping anything invalid', () => {
  const inv = new Inventory();
  inv.slots[0] = { id: ITEM.TORCH, count: 12 };
  inv.slots[35] = { id: ITEM.IRON_ORE, count: 64 };
  inv.select(4);
  const saved = JSON.parse(JSON.stringify(inv.toJSON()));

  const restored = new Inventory();
  restored.load(saved);
  assert.deepEqual(restored.slots, inv.slots);
  assert.equal(restored.selected, 4);

  const broken = new Inventory();
  broken.load({ slots: [[ITEM.DIRT, 5], [999, 3], [ITEM.SAND, -2], 'junk', [ITEM.LOG, 500]], selected: 42 });
  assert.deepEqual(broken.slots.slice(0, 5), [{ id: ITEM.DIRT, count: 5 }, null, null, null, { id: ITEM.LOG, count: MAX_STACK }]);
  assert.ok(broken.selected >= 0 && broken.selected < 9);
});
