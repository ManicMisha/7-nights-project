// Save data: what the player changed, and how it's encoded.
//
// The world is regenerated from its seed, so a save only stores the
// differences — per chunk, a ChunkDelta — plus world-level metadata (player,
// inventory, time). Chunk deltas are encoded as a small versioned binary
// format; storage.js writes them to IndexedDB.
//
// Chunk format (little-endian), version 1:
//   u32 magic 'N7CH' · u16 version · u16 reserved · i32 cx · i32 cz
//   u32 cell count,    then per cell:    u16 index · u8 material · i8 density
//   u32 piece count,   then per piece:   u32 key · u8 type · u8 tier · u8 rotation · u8 reserved · u16 health · u16 reserved
//   u32 harvest count, then per record:  u16 record index · u8 state · u8 reserved · f32 timer (seconds)
//
// When the format changes: bump CHUNK_FORMAT_VERSION, keep decoding every
// older version (migrating on read), and add a test with an old buffer.

import { CHUNK_VOLUME } from './chunk.js';

export const CHUNK_MAGIC = 0x4843374e; // 'N7CH' read as a little-endian u32
export const CHUNK_FORMAT_VERSION = 1;
export const META_FORMAT_VERSION = 1;

const HEADER_BYTES = 16;
const CELL_BYTES = 4;
const PIECE_BYTES = 12;
const HARVEST_BYTES = 8;

/**
 * Everything the player changed in one chunk. The Map objects are shared
 * with the loaded Chunk, so edits made in play land here directly.
 */
export class ChunkDelta {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.cells = new Map(); // cell index → packed (material | (density & 0xff) << 8)
    this.pieces = new Map(); // pieceKey → { type, tier, rotation, health }
    this.harvest = new Map(); // record index → { state, timer }
  }

  get isEmpty() {
    return this.cells.size === 0 && this.pieces.size === 0 && this.harvest.size === 0;
  }

  setCell(index, material, density) {
    this.cells.set(index, packCell(material, density));
  }
}

export function packCell(material, density) {
  return (material & 0xff) | ((density & 0xff) << 8);
}

export function unpackMaterial(packed) {
  return packed & 0xff;
}

export function unpackDensity(packed) {
  return ((packed >> 8) << 24) >> 24; // sign-extend the stored byte
}

export class SaveFormatError extends Error {}

export function encodeChunkDelta(delta) {
  const size = HEADER_BYTES
    + 4 + delta.cells.size * CELL_BYTES
    + 4 + delta.pieces.size * PIECE_BYTES
    + 4 + delta.harvest.size * HARVEST_BYTES;
  const buffer = new ArrayBuffer(size);
  const v = new DataView(buffer);
  let o = 0;
  v.setUint32(o, CHUNK_MAGIC, true); o += 4;
  v.setUint16(o, CHUNK_FORMAT_VERSION, true); o += 2;
  v.setUint16(o, 0, true); o += 2;
  v.setInt32(o, delta.cx, true); o += 4;
  v.setInt32(o, delta.cz, true); o += 4;

  v.setUint32(o, delta.cells.size, true); o += 4;
  for (const [index, packed] of delta.cells) {
    v.setUint16(o, index, true);
    v.setUint8(o + 2, unpackMaterial(packed));
    v.setInt8(o + 3, unpackDensity(packed));
    o += CELL_BYTES;
  }

  v.setUint32(o, delta.pieces.size, true); o += 4;
  for (const [key, p] of delta.pieces) {
    v.setUint32(o, key, true);
    v.setUint8(o + 4, p.type);
    v.setUint8(o + 5, p.tier);
    v.setUint8(o + 6, p.rotation);
    v.setUint8(o + 7, 0);
    v.setUint16(o + 8, Math.max(0, Math.min(0xffff, Math.round(p.health))), true);
    v.setUint16(o + 10, 0, true);
    o += PIECE_BYTES;
  }

  v.setUint32(o, delta.harvest.size, true); o += 4;
  for (const [index, h] of delta.harvest) {
    v.setUint16(o, index, true);
    v.setUint8(o + 2, h.state);
    v.setUint8(o + 3, 0);
    v.setFloat32(o + 4, h.timer || 0, true);
    o += HARVEST_BYTES;
  }
  return buffer;
}

export function decodeChunkDelta(buffer) {
  const v = new DataView(buffer);
  const need = (bytes, what) => {
    if (o + bytes > buffer.byteLength) throw new SaveFormatError(`Chunk save is truncated (${what})`);
  };
  let o = 0;
  need(HEADER_BYTES, 'header');
  if (v.getUint32(0, true) !== CHUNK_MAGIC) throw new SaveFormatError('Not a 7 Nights chunk save');
  const version = v.getUint16(4, true);
  if (version > CHUNK_FORMAT_VERSION) {
    throw new SaveFormatError(`Chunk save version ${version} is newer than this game (${CHUNK_FORMAT_VERSION})`);
  }
  const delta = new ChunkDelta(v.getInt32(8, true), v.getInt32(12, true));
  o = HEADER_BYTES;

  need(4, 'cell count');
  const cells = v.getUint32(o, true); o += 4;
  need(cells * CELL_BYTES, 'cells');
  for (let i = 0; i < cells; i++, o += CELL_BYTES) {
    const index = v.getUint16(o, true);
    if (index >= CHUNK_VOLUME) throw new SaveFormatError(`Cell index ${index} out of range`);
    delta.setCell(index, v.getUint8(o + 2), v.getInt8(o + 3));
  }

  need(4, 'piece count');
  const pieces = v.getUint32(o, true); o += 4;
  need(pieces * PIECE_BYTES, 'pieces');
  for (let i = 0; i < pieces; i++, o += PIECE_BYTES) {
    delta.pieces.set(v.getUint32(o, true), {
      type: v.getUint8(o + 4),
      tier: v.getUint8(o + 5),
      rotation: v.getUint8(o + 6) & 3,
      health: v.getUint16(o + 8, true),
    });
  }

  need(4, 'harvest count');
  const harvest = v.getUint32(o, true); o += 4;
  need(harvest * HARVEST_BYTES, 'harvest records');
  for (let i = 0; i < harvest; i++, o += HARVEST_BYTES) {
    delta.harvest.set(v.getUint16(o, true), { state: v.getUint8(o + 2), timer: v.getFloat32(o + 4, true) });
  }
  return delta;
}

/**
 * World-level save data (stored as a plain object). `generatorVersion`
 * guards against applying edits to terrain generated differently.
 */
export function makeWorldMeta({ worldId, seed, generatorVersion, player, inventory, timeOfDay }) {
  return {
    formatVersion: META_FORMAT_VERSION,
    worldId,
    seed,
    generatorVersion,
    savedAt: Date.now(),
    player,
    inventory,
    timeOfDay,
  };
}

/** Why a saved world can't be loaded, or null if it can. */
export function metaProblem(meta, generatorVersion) {
  if (!meta || typeof meta !== 'object') return 'The save is missing or damaged.';
  if (meta.formatVersion > META_FORMAT_VERSION) return 'The save was made by a newer version of the game.';
  if (meta.generatorVersion !== generatorVersion) {
    return 'The save was made with an older world generator, so its changes no longer match the terrain.';
  }
  return null;
}
