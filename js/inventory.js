// 36-slot inventory (slots 0–8 are the hotbar) with stacking.

import { MAT } from './materials.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const MAX_STACK = 64;

export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY_SIZE).fill(null); // { id, count } | null
    this.selected = 0;
    this.listeners = [];
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  giveStarterKit() {
    const kit = [
      [MAT.PLANKS, 64], [MAT.COBBLESTONE, 64], [MAT.TORCH, 32], [MAT.GLASS, 32],
      [MAT.BRICKS, 64], [MAT.GLOWSTONE, 16], [MAT.LOG, 32], [MAT.SANDSTONE, 32], [MAT.DIRT, 32],
    ];
    kit.forEach(([id, count], i) => {
      this.slots[i] = { id, count };
    });
    this.changed();
  }

  get selectedStack() {
    return this.slots[this.selected];
  }

  select(index) {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.changed();
  }

  /** Adds items, filling existing stacks first (hotbar first). Returns leftover. */
  add(id, count = 1) {
    if (!id) return 0;
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < MAX_STACK) {
        const n = Math.min(count, MAX_STACK - s.count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, MAX_STACK);
        this.slots[i] = { id, count: n };
        count -= n;
      }
    }
    this.changed();
    return count;
  }

  /** Removes one item from the selected hotbar slot. */
  consumeSelected() {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /**
   * Click interaction for the inventory screen: swaps/merges the stack held
   * on the cursor with the one in `index`. Returns the new cursor stack.
   */
  clickSlot(index, cursor, half = false) {
    const slot = this.slots[index];
    if (!cursor) {
      if (!slot) return null;
      if (half && slot.count > 1) {
        const take = Math.ceil(slot.count / 2);
        slot.count -= take;
        this.changed();
        return { id: slot.id, count: take };
      }
      this.slots[index] = null;
      this.changed();
      return slot;
    }
    if (!slot) {
      if (half) {
        this.slots[index] = { id: cursor.id, count: 1 };
        cursor.count--;
        this.changed();
        return cursor.count > 0 ? cursor : null;
      }
      this.slots[index] = cursor;
      this.changed();
      return null;
    }
    if (slot.id === cursor.id) {
      const moving = half ? 1 : cursor.count;
      const n = Math.min(moving, MAX_STACK - slot.count);
      slot.count += n;
      cursor.count -= n;
      this.changed();
      return cursor.count > 0 ? cursor : null;
    }
    this.slots[index] = cursor;
    this.changed();
    return slot;
  }
}
