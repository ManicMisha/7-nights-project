// Procedural 32×32 pixel-art textures, painted at startup (no image assets).
// Tiles are uploaded as a single mip-mapped texture array (one layer per
// tile), which avoids atlas bleeding while keeping everything in one draw
// state. The same pixels are reused for hotbar icons and break particles.

import * as THREE from 'three';
import { TILES, MAT_RENDER, MAT_TILES, RENDER } from './materials.js';
import { mulberry32, hashSeed } from './noise.js';

export const TILE_SIZE = 32;
const S = TILE_SIZE;

// ---------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------

/** Tileable value noise: `cells` lattice cells across the tile. */
function valueNoise(rand, cells) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (x, y) => {
    const fx = (x / S) * cells;
    const fy = (y / S) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const g = (gx, gy) => grid[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Tileable Worley (cellular) noise: returns [d1, d2, cellIndex]. */
function worley(rand, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * S, rand() * S]);
  return (x, y) => {
    let d1 = 1e9;
    let d2 = 1e9;
    let idx = 0;
    for (let i = 0; i < count; i++) {
      let dx = Math.abs(x - pts[i][0]);
      let dy = Math.abs(y - pts[i][1]);
      dx = Math.min(dx, S - dx);
      dy = Math.min(dy, S - dy);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; idx = i; } else if (d < d2) d2 = d;
    }
    return [d1, d2, idx];
  };
}

class Tile {
  constructor() {
    this.data = new Uint8ClampedArray(S * S * 4);
  }
  set(x, y, r, g, b, a = 255) {
    const i = (y * S + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = a;
  }
  get(x, y) {
    const i = (y * S + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  /** Fill with a base colour modulated by a per-pixel brightness function. */
  fill(rgb, shade) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = shade(x, y);
        this.set(x, y, rgb[0] * k, rgb[1] * k, rgb[2] * k);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tile painters
// ---------------------------------------------------------------------------

function paintStone(t, rand) {
  const n1 = valueNoise(rand, 4);
  const n2 = valueNoise(rand, 16);
  t.fill([128, 128, 130], (x, y) => {
    let k = 0.76 + n1(x, y) * 0.2 + n2(x, y) * 0.12 + (rand() - 0.5) * 0.12;
    if (n2(x, y) > 0.8) k *= 0.8;
    return k;
  });
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const k = rand() > 0.5 ? 1.12 : 0.7;
    t.set(x, y, 128 * k, 128 * k, 130 * k);
    t.set((x + 1) % S, y, 128 * k, 128 * k, 130 * k);
  }
}

function paintDirt(t, rand) {
  const n1 = valueNoise(rand, 8);
  t.fill([134, 96, 67], (x, y) => 0.8 + n1(x, y) * 0.25 + rand() * 0.08);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const light = rand() > 0.5;
    const c = light ? [160, 122, 88] : [98, 68, 46];
    t.set(x, y, ...c);
    if (rand() > 0.5) t.set((x + 1) % S, y, ...c);
  }
}

function paintGrassTop(t, rand) {
  const n1 = valueNoise(rand, 8);
  const n2 = valueNoise(rand, 16);
  t.fill([92, 158, 58], (x, y) => 0.78 + n1(x, y) * 0.2 + n2(x, y) * 0.12 + rand() * 0.08);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    const c = rand() > 0.5 ? [118, 186, 72] : [70, 128, 44];
    t.set(x, y, ...c);
  }
}

function paintGrassSide(t, rand) {
  paintDirt(t, rand);
  const top = new Tile();
  paintGrassTop(top, mulberry32(hashSeed('grass_top')));
  for (let x = 0; x < S; x++) {
    const depth = 5 + Math.floor(rand() * 4) + (rand() > 0.8 ? 3 : 0);
    for (let y = 0; y < depth; y++) {
      const [r, g, b] = top.get(x, y);
      const k = y === depth - 1 ? 0.8 : 1;
      t.set(x, y, r * k, g * k, b * k);
    }
  }
}

function paintSand(t, rand) {
  const n1 = valueNoise(rand, 8);
  t.fill([219, 206, 160], (x, y) => 0.9 + n1(x, y) * 0.1 + rand() * 0.07);
  for (let i = 0; i < 30; i++) {
    t.set(Math.floor(rand() * S), Math.floor(rand() * S), 196, 180, 132);
  }
}

function paintWater(t, rand) {
  const n1 = valueNoise(rand, 4);
  t.fill([48, 92, 205], (x, y) => 0.8 + n1(x, y) * 0.25 + Math.sin((x + y * 0.5) * 0.6) * 0.05);
}

function paintLogSide(t, rand) {
  const cols = new Float32Array(S);
  for (let x = 0; x < S; x++) cols[x] = rand();
  const n1 = valueNoise(rand, 4);
  t.fill([104, 80, 50], (x, y) => {
    let k = 0.75 + cols[x] * 0.25 + n1(x, y) * 0.15;
    if (cols[x] < 0.18) k *= 0.7;
    return k;
  });
}

function paintLogTop(t, rand) {
  const n1 = valueNoise(rand, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const d = Math.max(Math.abs(dx), Math.abs(dy)) + n1(x, y) * 1.5;
      if (d > 14) {
        const k = 0.8 + rand() * 0.2;
        t.set(x, y, 104 * k, 80 * k, 50 * k);
      } else {
        const ring = 0.85 + Math.sin(d * 1.3) * 0.1 + rand() * 0.04;
        t.set(x, y, 178 * ring, 142 * ring, 90 * ring);
      }
    }
  }
}

function paintLeaves(t, rand) {
  const n1 = valueNoise(rand, 8);
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const hole = rand() < 0.16;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const k = 0.65 + n1(x + ox, y + oy) * 0.35 + rand() * 0.15;
          t.set(x + ox, y + oy, 58 * k, 128 * k, 38 * k, hole ? 0 : 255);
        }
      }
    }
  }
}

function paintPlanks(t, rand) {
  const n1 = valueNoise(rand, 16);
  for (let y = 0; y < S; y++) {
    const board = Math.floor(y / 8);
    const joint = (board * 13 + 5) % S;
    for (let x = 0; x < S; x++) {
      let k = 0.84 + n1(x, y * 0.25) * 0.18 + Math.sin(x * 0.9 + board * 3) * 0.03;
      if (y % 8 === 7) k = 0.58;
      else if (x === joint) k = 0.66;
      t.set(x, y, 168 * k, 134 * k, 82 * k);
    }
  }
}

function paintCobblestone(t, rand) {
  const w = worley(rand, 14);
  const tone = [];
  for (let i = 0; i < 14; i++) tone.push(0.72 + rand() * 0.35);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [d1, d2, idx] = w(x, y);
      const edge = d2 - d1;
      let k = tone[idx] * (1 - d1 * 0.02) + rand() * 0.05;
      if (edge < 1.4) k = 0.38 + rand() * 0.06;
      t.set(x, y, 122 * k, 122 * k, 124 * k);
    }
  }
}

function paintGlass(t, rand) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const frame = x < 2 || y < 2 || x > S - 3 || y > S - 3;
      if (frame) {
        const k = 0.9 + rand() * 0.1;
        t.set(x, y, 205 * k, 232 * k, 240 * k, 255);
      } else {
        const streak = (x + y === 12 || x + y === 13 || x + y === 22) && x > 4 && x < 20;
        t.set(x, y, 235, 248, 255, streak ? 255 : 0);
      }
    }
  }
}

function paintBedrock(t, rand) {
  const n1 = valueNoise(rand, 8);
  const n2 = valueNoise(rand, 16);
  t.fill([90, 90, 92], (x, y) => {
    const v = n1(x, y) * 0.6 + n2(x, y) * 0.4;
    return v > 0.55 ? 1.25 : v < 0.4 ? 0.35 : 0.75;
  });
}

function paintGravel(t, rand) {
  const w = worley(rand, 26);
  const tone = [];
  for (let i = 0; i < 26; i++) {
    const g = 0.6 + rand() * 0.55;
    tone.push([g * (0.95 + rand() * 0.1), g, g * (0.9 + rand() * 0.15)]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [d1, d2, idx] = w(x, y);
      const edge = d2 - d1 < 1 ? 0.55 : 1;
      const [r, g, b] = tone[idx];
      t.set(x, y, 130 * r * edge, 124 * g * edge, 118 * b * edge);
    }
  }
}

function paintSnow(t, rand) {
  const n1 = valueNoise(rand, 8);
  t.fill([242, 246, 252], (x, y) => 0.93 + n1(x, y) * 0.07 + rand() * 0.02);
}

function paintSnowSide(t, rand) {
  paintStone(t, mulberry32(hashSeed('stone')));
  const snow = new Tile();
  paintSnow(snow, rand);
  for (let x = 0; x < S; x++) {
    const depth = 6 + Math.floor(rand() * 5);
    for (let y = 0; y < depth; y++) t.set(x, y, ...snow.get(x, y));
  }
}

function paintOre(t, rand, color, dark) {
  paintStone(t, mulberry32(hashSeed('stone')));
  for (let c = 0; c < 6; c++) {
    const cx = 4 + rand() * 24;
    const cy = 4 + rand() * 24;
    const size = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < size * 3; i++) {
      const x = Math.floor(cx + (rand() - 0.5) * size * 2);
      const y = Math.floor(cy + (rand() - 0.5) * size * 2);
      const k = 0.85 + rand() * 0.3;
      t.set(x, y, color[0] * k, color[1] * k, color[2] * k);
      t.set(Math.min(S - 1, x + 1), y, dark[0], dark[1], dark[2]);
    }
  }
}

function paintTorch(t) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (x >= 14 && x <= 17 && y >= 12) {
        const k = x === 14 ? 0.75 : 1;
        t.set(x, y, 120 * k, 88 * k, 50 * k, 255);
      } else if (x >= 13 && x <= 18 && y >= 6 && y < 12) {
        const hot = x >= 15 && x <= 16 && y >= 8;
        t.set(x, y, 255, hot ? 250 : 190, hot ? 190 : 60, 255);
      } else {
        t.set(x, y, 0, 0, 0, 0);
      }
    }
  }
}

function paintGlowstone(t, rand) {
  const w = worley(rand, 12);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [d1, d2] = w(x, y);
      const edge = d2 - d1 < 1.6;
      const k = edge ? 0.62 : 1 - d1 * 0.03 + rand() * 0.05;
      t.set(x, y, 255 * k, 214 * k, 128 * k);
    }
  }
}

function paintTallGrass(t, rand) {
  for (let i = 0; i < S * S; i++) t.data[i * 4 + 3] = 0;
  for (let b = 0; b < 12; b++) {
    const x0 = 3 + rand() * 26;
    const height = 12 + rand() * 18;
    const lean = (rand() - 0.5) * 0.4;
    for (let h = 0; h < height; h++) {
      const x = Math.round(x0 + lean * h);
      const y = S - 1 - h;
      if (x < 0 || x >= S) continue;
      const k = 0.7 + (h / height) * 0.4;
      t.set(x, y, 80 * k, 150 * k, 50 * k, 255);
    }
  }
}

function paintFlower(t, rand, petal, center, headY) {
  for (let i = 0; i < S * S; i++) t.data[i * 4 + 3] = 0;
  for (let y = headY + 4; y < S; y++) {
    t.set(15, y, 60, 128, 40, 255);
    t.set(16, y, 48, 110, 32, 255);
  }
  for (let i = 0; i < 5; i++) {
    t.set(17 + i, 24 - i, 70, 140, 45, 255);
    t.set(14 - i, 26 - i, 70, 140, 45, 255);
  }
  for (let y = headY - 3; y <= headY + 3; y++) {
    for (let x = 12; x <= 19; x++) {
      const dx = x - 15.5;
      const dy = y - headY;
      if (dx * dx + dy * dy > 13) continue;
      const k = 0.8 + rand() * 0.25;
      t.set(x, y, petal[0] * k, petal[1] * k, petal[2] * k, 255);
    }
  }
  t.set(15, headY, ...center, 255);
  t.set(16, headY, ...center, 255);
}

function paintBricks(t, rand) {
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / 8);
    const offset = row % 2 === 0 ? 0 : 8;
    for (let x = 0; x < S; x++) {
      const mortar = y % 8 >= 6 || (x + offset) % 16 >= 14;
      if (mortar) {
        const k = 0.9 + rand() * 0.1;
        t.set(x, y, 178 * k, 170 * k, 158 * k);
      } else {
        const brick = Math.floor((x + offset) / 16) + row * 3;
        const k = 0.82 + ((brick * 37) % 10) / 50 + rand() * 0.08;
        t.set(x, y, 152 * k, 68 * k, 52 * k);
      }
    }
  }
}

function paintSandstoneSide(t, rand) {
  const n1 = valueNoise(rand, 8);
  t.fill([214, 198, 148], (x, y) => {
    let k = 0.9 + n1(x, y) * 0.08 + rand() * 0.04;
    if (y < 5) k *= 1.05;
    if (y === 5 || y === 22) k *= 0.8;
    if (y > 26) k *= 0.9;
    return k;
  });
}

function paintSandstoneTop(t, rand) {
  const n1 = valueNoise(rand, 4);
  t.fill([220, 204, 154], (x, y) => 0.92 + n1(x, y) * 0.08 + rand() * 0.03);
}

const PAINTERS = {
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  dirt: paintDirt,
  stone: paintStone,
  sand: paintSand,
  water: paintWater,
  log_side: paintLogSide,
  log_top: paintLogTop,
  leaves: paintLeaves,
  planks: paintPlanks,
  cobblestone: paintCobblestone,
  glass: paintGlass,
  bedrock: paintBedrock,
  gravel: paintGravel,
  snow: paintSnow,
  snow_side: paintSnowSide,
  coal_ore: (t, r) => paintOre(t, r, [40, 40, 42], [24, 24, 26]),
  iron_ore: (t, r) => paintOre(t, r, [216, 176, 146], [150, 110, 86]),
  torch: paintTorch,
  glowstone: paintGlowstone,
  tall_grass: paintTallGrass,
  red_flower: (t, r) => paintFlower(t, r, [210, 30, 36], [40, 20, 20], 9),
  yellow_flower: (t, r) => paintFlower(t, r, [245, 216, 40], [230, 160, 20], 12),
  bricks: paintBricks,
  sandstone_side: paintSandstoneSide,
  sandstone_top: paintSandstoneTop,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class TextureLibrary {
  constructor() {
    this.tiles = TILES.map((name) => {
      const tile = new Tile();
      PAINTERS[name](tile, mulberry32(hashSeed(name)));
      return tile;
    });
    this.array = this.buildTextureArray();
    this.averageColors = this.tiles.map((tile) => averageColor(tile));
    this.crackTextures = buildCrackTextures();
    this.iconCache = new Map();
  }

  buildTextureArray() {
    const layers = this.tiles.length;
    const data = new Uint8Array(S * S * 4 * layers);
    this.tiles.forEach((tile, layer) => {
      // Flip rows: painters draw with y=0 at the top, GL samples v=0 at the bottom.
      for (let y = 0; y < S; y++) {
        const src = tile.data.subarray((S - 1 - y) * S * 4, (S - y) * S * 4);
        data.set(src, layer * S * S * 4 + y * S * 4);
      }
    });
    const tex = new THREE.DataArrayTexture(data, S, S, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  /** A tile as a canvas (for UI use). */
  tileCanvas(layer) {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    c.getContext('2d').putImageData(new ImageData(this.tiles[layer].data, S, S), 0, 0);
    return c;
  }

  /** Isometric inventory icon for a block, as a data URL (cached). */
  icon(blockId) {
    if (this.iconCache.has(blockId)) return this.iconCache.get(blockId);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const top = this.tileCanvas(MAT_TILES[blockId * 3]);
    const side = this.tileCanvas(MAT_TILES[blockId * 3 + 2]);
    if (MAT_RENDER[blockId] === RENDER.CROSS) {
      ctx.drawImage(side, 8, 8, 48, 48);
    } else {
      const h = size / 4; // quarter height for isometric projection
      const w = size / 2;
      // Top face
      ctx.setTransform(w / S, h / S, -w / S, h / S, w, 2);
      ctx.drawImage(top, 0, 0);
      // Left face
      ctx.setTransform(w / S, h / S, 0, (w * 0.875) / S, 0, h + 2);
      ctx.drawImage(side, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, S, S);
      // Right face
      ctx.setTransform(w / S, -h / S, 0, (w * 0.875) / S, w, 2 * h + 2);
      ctx.drawImage(side, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, S, S);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const url = canvas.toDataURL();
    this.iconCache.set(blockId, url);
    return url;
  }
}

function averageColor(tile) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < tile.data.length; i += 4) {
    if (tile.data[i + 3] < 128) continue;
    r += tile.data[i];
    g += tile.data[i + 1];
    b += tile.data[i + 2];
    n++;
  }
  n = Math.max(1, n);
  return [r / n / 255, g / n / 255, b / n / 255];
}

/** Ten progressively cracked overlays shown while a block is being mined. */
function buildCrackTextures() {
  const rand = mulberry32(hashSeed('cracks'));
  // Random-walk crack segments radiating out from the centre.
  const segments = [];
  for (let branch = 0; branch < 9; branch++) {
    let x = 16;
    let y = 16;
    let angle = rand() * Math.PI * 2;
    for (let step = 0; step < 14; step++) {
      angle += (rand() - 0.5) * 1.1;
      const nx = x + Math.cos(angle) * 2;
      const ny = y + Math.sin(angle) * 2;
      segments.push({ x, y, nx, ny, order: step + rand() * 3 });
      x = nx;
      y = ny;
    }
  }
  const maxOrder = Math.max(...segments.map((s) => s.order));
  const textures = [];
  for (let stage = 0; stage < 10; stage++) {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(20,20,20,0.85)';
    ctx.lineWidth = 1.2;
    const limit = ((stage + 1) / 10) * maxOrder;
    for (const s of segments) {
      if (s.order > limit) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(s.x) + 0.5, Math.round(s.y) + 0.5);
      ctx.lineTo(Math.round(s.nx) + 0.5, Math.round(s.ny) + 0.5);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    textures.push(tex);
  }
  return textures;
}
