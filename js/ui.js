// DOM HUD: hotbar, hearts, debug overlay, inventory screen, menus.

import { BLOCK_NAME, PLACEABLE_BLOCKS } from './blocks.js';
import { HOTBAR_SIZE, INVENTORY_SIZE, MAX_STACK } from './inventory.js';
import { PLAYER } from './config.js';

const $ = (id) => document.getElementById(id);

function heartIcon(fill) {
  // 9×9 pixel heart; fill = 'full' | 'half' | 'empty'.
  const rows = [
    '.oo...oo.',
    'orro.orro',
    'orrrorrro',
    'orrrrrrro',
    '.orrrrro.',
    '..orrro..',
    '...oro...',
    '....o....',
  ];
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let color = '#1a0a0a';
      if (ch === 'r') {
        const filled = fill === 'full' || (fill === 'half' && x < 5);
        color = filled ? (y < 2 ? '#ff8080' : '#e01b24') : '#3a1a1a';
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return c.toDataURL();
}

export class UI {
  constructor(textures, inventory) {
    this.textures = textures;
    this.inventory = inventory;
    this.cursor = null; // stack held on the mouse in the inventory screen
    this.toastTimer = 0;
    this.debugVisible = false;
    this.hearts = { full: heartIcon('full'), half: heartIcon('half'), empty: heartIcon('empty') };

    this.buildHotbar();
    this.buildHealth();
    this.buildInventoryScreen();
    inventory.onChange(() => this.refreshSlots());
    this.refreshSlots();

    document.addEventListener('mousemove', (e) => {
      const el = $('cursor-item');
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
    });
  }

  slotElement(extraClass = '') {
    const el = document.createElement('div');
    el.className = `slot ${extraClass}`;
    el.innerHTML = '<img alt="" draggable="false"><span class="count"></span>';
    return el;
  }

  fillSlot(el, stack) {
    const img = el.querySelector('img');
    const count = el.querySelector('.count');
    if (stack) {
      const src = this.textures.icon(stack.id);
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.style.visibility = 'visible';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
      el.title = BLOCK_NAME[stack.id];
    } else {
      img.style.visibility = 'hidden';
      count.textContent = '';
      el.title = '';
    }
  }

  buildHotbar() {
    const bar = $('hotbar');
    this.hotbarSlots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.slotElement();
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      el.appendChild(key);
      bar.appendChild(el);
      this.hotbarSlots.push(el);
    }
  }

  buildHealth() {
    const box = $('health');
    this.heartEls = [];
    for (let i = 0; i < PLAYER.maxHealth / 2; i++) {
      const img = document.createElement('img');
      img.alt = '';
      box.appendChild(img);
      this.heartEls.push(img);
    }
    this.lastHealth = -1;
  }

  buildInventoryScreen() {
    const grid = $('inv-grid');
    const hotbar = $('inv-hotbar');
    this.invSlots = new Array(INVENTORY_SIZE);
    const make = (i, parent) => {
      const el = this.slotElement();
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.cursor = this.inventory.clickSlot(i, this.cursor, e.button === 2);
        this.refreshCursor();
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      parent.appendChild(el);
      this.invSlots[i] = el;
    };
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) make(i, grid);
    for (let i = 0; i < HOTBAR_SIZE; i++) make(i, hotbar);

    const palette = $('palette');
    for (const id of PLACEABLE_BLOCKS) {
      const el = this.slotElement('palette-slot');
      this.fillSlot(el, { id, count: 1 });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // Clicking the palette with an item held deletes it; otherwise takes a full stack.
        this.cursor = this.cursor ? null : { id, count: MAX_STACK };
        this.refreshCursor();
      });
      palette.appendChild(el);
    }
  }

  refreshSlots() {
    const inv = this.inventory;
    this.hotbarSlots.forEach((el, i) => {
      this.fillSlot(el, inv.slots[i]);
      el.classList.toggle('selected', i === inv.selected);
    });
    this.invSlots.forEach((el, i) => this.fillSlot(el, inv.slots[i]));
    if (this.lastSelected !== inv.selected || this.lastSelectedId !== inv.selectedStack?.id) {
      this.lastSelected = inv.selected;
      this.lastSelectedId = inv.selectedStack?.id;
      if (inv.selectedStack) this.toast(BLOCK_NAME[inv.selectedStack.id]);
    }
  }

  refreshCursor() {
    const el = $('cursor-item');
    if (!this.cursor) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.querySelector('img').src = this.textures.icon(this.cursor.id);
    el.querySelector('.count').textContent = this.cursor.count > 1 ? String(this.cursor.count) : '';
  }

  /** Returns any item held on the cursor to the inventory. */
  closeInventory() {
    if (this.cursor) this.inventory.add(this.cursor.id, this.cursor.count);
    this.cursor = null;
    this.refreshCursor();
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('visible');
    this.toastTimer = 1.6;
  }

  flashDamage() {
    const v = $('vignette');
    v.classList.remove('hurt');
    void v.offsetWidth; // restart the CSS animation
    v.classList.add('hurt');
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    $('debug').hidden = !this.debugVisible;
  }

  update(dt, info) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').classList.remove('visible');
    }
    if (info.health !== this.lastHealth) {
      this.lastHealth = info.health;
      this.heartEls.forEach((img, i) => {
        const v = info.health - i * 2;
        img.src = v >= 2 ? this.hearts.full : v === 1 ? this.hearts.half : this.hearts.empty;
      });
    }
    $('underwater').classList.toggle('active', info.underwater);
    $('clock').textContent = `${info.clock}${info.night ? ' ☾' : ' ☀'}${info.flying ? '  ·  flying' : ''}`;
    if (this.debugVisible) $('debug').textContent = info.debugText();
  }
}
