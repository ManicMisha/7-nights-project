// Stylized terrain textures, painted in code from the art-style palette.
//
// One tileable 128×128 layer per terrain class (grass, soil, rock, sand,
// snow), soft and painterly rather than photographic: broad tonal shapes,
// a few confident details (blade strokes, pebbles, bevelled rock facets,
// sand ripples). The alpha channel holds a height map that the terrain
// shader uses for height-based blending, so materials meet along natural
// edges (grass creeping between rocks) instead of a blurry cross-fade.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { TERRAIN_CLASS, TERRAIN_CLASS_COUNT } from './materials.js';
import { mulberry32, hashSeed } from './noise.js';

export const TERRAIN_TEXTURE_SIZE = 128;
const S = TERRAIN_TEXTURE_SIZE;

// ---------------------------------------------------------------------------
// Helpers (all tileable over S × S)
// ---------------------------------------------------------------------------

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Tileable value noise with `cells` lattice cells across the texture. */
function valueNoise(rand, cells) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const g = (x, y) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  return (x, y) => {
    const fx = (x / S) * cells;
    const fy = (y / S) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let tx = fx - x0;
    let ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

/** Sum of value-noise octaves, roughly 0…1. */
function fbm(rand, baseCells, octaves) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(valueNoise(rand, baseCells << o));
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const n of layers) {
      sum += n(x, y) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

/** Tileable Worley noise: nearest and second-nearest distances and cell id. */
function worley(rand, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * S, rand() * S]);
  return (x, y) => {
    let d1 = 1e9;
    let d2 = 1e9;
    let id = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < count; i++) {
      let dx = x - pts[i][0];
      let dy = y - pts[i][1];
      if (dx > S / 2) dx -= S; else if (dx < -S / 2) dx += S;
      if (dy > S / 2) dy -= S; else if (dy < -S / 2) dy += S;
      const d = Math.hypot(dx, dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = i;
        cx = dx;
        cy = dy;
      } else if (d < d2) {
        d2 = d;
      }
    }
    return { d1, d2, id, dx: cx, dy: cy };
  };
}

class Layer {
  constructor() {
    this.data = new Uint8ClampedArray(S * S * 4);
  }
  set(x, y, c, height) {
    const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = clamp01(height) * 255;
  }
  get(x, y) {
    const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3] / 255];
  }
}

/** Draws a soft round dab (for pebbles, grains, sparkles). */
function dab(layer, cx, cy, r, colour, height, strength = 1) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const k = (1 - d * d) * strength;
      const [pr, pg, pb, ph] = layer.get(x, y);
      layer.set(x, y, mix([pr, pg, pb], colour, Math.min(1, k * 1.4)), Math.max(ph, height * k + ph * (1 - k)));
    }
  }
}

// ---------------------------------------------------------------------------
// Painters
// ---------------------------------------------------------------------------

function paintGrass(layer, rand) {
  const base = rgb(PALETTE.grass);
  const shade = rgb(PALETTE.grassShade);
  const light = [150, 214, 96];
  const patches = fbm(rand, 3, 3);
  const fine = valueNoise(rand, 32);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = patches(x, y);
      let c = p < 0.5 ? mix(shade, base, 0.35 + p * 1.3) : mix(base, light, (p - 0.5) * 1.1);
      c = scale(c, 0.96 + fine(x, y) * 0.08);
      layer.set(x, y, c, 0.35 + p * 0.3);
    }
  }
  // Short blade strokes, lighter and darker, leaning the same way.
  for (let i = 0; i < 1400; i++) {
    const x0 = rand() * S;
    const y0 = rand() * S;
    const len = 2 + rand() * 4;
    const lean = (rand() - 0.5) * 0.8;
    const bright = rand() > 0.45;
    const colour = bright ? mix(base, light, 0.6 + rand() * 0.4) : mix(shade, base, rand() * 0.5);
    for (let t = 0; t < len; t++) {
      const x = Math.round(x0 + lean * t);
      const y = Math.round(y0 - t);
      const [r, g, b, h] = layer.get(x, y);
      layer.set(x, y, mix([r, g, b], colour, 0.75), Math.min(1, h + 0.15 * (1 - t / len)));
    }
  }
}

function paintSoil(layer, rand) {
  const base = rgb(PALETTE.dirt);
  const dark = scale(base, 0.78);
  const light = mix(base, [214, 170, 120], 0.35);
  const tone = fbm(rand, 4, 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = tone(x, y);
      layer.set(x, y, mix(dark, light, t), 0.2 + t * 0.3);
    }
  }
  for (let i = 0; i < 90; i++) {
    const r = 1.5 + rand() * 2.8;
    const colour = rand() > 0.5 ? mix(base, [200, 170, 140], 0.5 + rand() * 0.3) : scale(base, 0.7 + rand() * 0.15);
    dab(layer, rand() * S, rand() * S, r, colour, 0.75 + rand() * 0.25);
  }
}

function paintRock(layer, rand) {
  const base = rgb(PALETTE.rock);
  const dark = rgb(PALETTE.rockDark);
  const cells = worley(rand, 14);
  const tone = [];
  for (let i = 0; i < 14; i++) tone.push(0.92 + rand() * 0.14);
  const strata = valueNoise(rand, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const w = cells(x, y);
      const edge = w.d2 - w.d1;
      // Bevel: facets catch light on one side, like chunky carved stone.
      const bevel = Math.max(-0.12, Math.min(0.12, -(w.dx * 0.6 + w.dy * 0.8) / 70));
      const band = Math.sin((y + strata(x, y) * 18) * 0.35) * 0.03;
      let c = scale(base, tone[w.id] + bevel + band);
      let h = clamp01(0.85 - w.d1 / 40);
      if (edge < 2.2) {
        const k = 1 - edge / 2.2;
        c = mix(c, dark, k * 0.6);
        h *= 1 - k * 0.8;
      }
      layer.set(x, y, c, h);
    }
  }
}

function paintSand(layer, rand) {
  const base = rgb(PALETTE.sand);
  const shade = mix(base, [205, 170, 110], 0.55);
  const warp = fbm(rand, 4, 2);
  const tone = fbm(rand, 3, 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Wind ripples: gentle bands bent by noise (tileable: 8 bands per tile).
      const ripple = 0.5 + 0.5 * Math.sin(((y + warp(x, y) * 14) / S) * Math.PI * 2 * 8);
      const c = mix(shade, base, 0.55 + ripple * 0.3 + (tone(x, y) - 0.5) * 0.3);
      layer.set(x, y, c, 0.3 + ripple * 0.25);
    }
  }
  for (let i = 0; i < 260; i++) {
    const colour = rand() > 0.5 ? mix(base, [255, 245, 215], 0.6) : mix(base, [180, 140, 90], 0.5);
    dab(layer, rand() * S, rand() * S, 0.8 + rand() * 0.6, colour, 0.6, 0.8);
  }
}

function paintSnow(layer, rand) {
  const base = rgb(PALETTE.snow);
  const shade = [214, 226, 242];
  const tone = fbm(rand, 3, 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = tone(x, y);
      layer.set(x, y, mix(shade, base, clamp01(t * 1.5 - 0.1)), 0.25 + t * 0.35);
    }
  }
  for (let i = 0; i < 120; i++) dab(layer, rand() * S, rand() * S, 0.7, [255, 255, 255], 0.5, 0.9);
}

const PAINTERS = {
  [TERRAIN_CLASS.GRASS]: paintGrass,
  [TERRAIN_CLASS.SOIL]: paintSoil,
  [TERRAIN_CLASS.ROCK]: paintRock,
  [TERRAIN_CLASS.SAND]: paintSand,
  [TERRAIN_CLASS.SNOW]: paintSnow,
};
const NAMES = ['grass', 'soil', 'rock', 'sand', 'snow'];

/** Paints every terrain layer (RGBA8, alpha = height), for inspection or upload. */
export function paintTerrainLayers() {
  const layers = [];
  for (let cls = 0; cls < TERRAIN_CLASS_COUNT; cls++) {
    const layer = new Layer();
    PAINTERS[cls](layer, mulberry32(hashSeed(`terrain-${NAMES[cls]}`)));
    layers.push(layer.data);
  }
  return layers;
}

/** The terrain layers as one mip-mapped, repeating texture array. */
export function createTerrainTexture() {
  const layers = paintTerrainLayers();
  const data = new Uint8Array(S * S * 4 * layers.length);
  layers.forEach((layer, i) => data.set(layer, i * S * S * 4));
  const tex = new THREE.DataArrayTexture(data, S, S, layers.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace; // colour is sRGB; alpha (height) stays linear
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4; // sharp grass at grazing angles; cheap on GPUs (Phase 11's Low preset can drop it)
  tex.needsUpdate = true;
  return tex;
}
