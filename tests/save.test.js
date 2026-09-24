import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChunkDelta, encodeChunkDelta, decodeChunkDelta, packCell, unpackMaterial, unpackDensity,
  SaveFormatError, CHUNK_FORMAT_VERSION, makeWorldMeta, metaProblem,
} from '../js/save.js';
import { MAT } from '../js/materials.js';
import { PIECE, TIER, makePiece, pieceKey, pieceSlot } from '../js/pieces.js';
import { HARVEST_STATE } from '../js/harvestables.js';
import { CHUNK_VOLUME } from '../js/chunk.js';

function sampleDelta() {
  const d = new ChunkDelta(-3, 12);
  d.setCell(0, MAT.STONE, 127);
  d.setCell(CHUNK_VOLUME - 1, MAT.AIR, -127);
  d.setCell(4242, MAT.DIRT, 37); // partially filled
  d.setCell(777, MAT.AIR, -5);
  d.pieces.set(pieceKey(100, pieceSlot(PIECE.WALL, 2)), makePiece(PIECE.WALL, TIER.STONE, 2));
  d.pieces.set(pieceKey(100, pieceSlot(PIECE.FLOOR, 0)), makePiece(PIECE.FLOOR, TIER.WOOD, 0));
  d.harvest.set(3, { state: HARVEST_STATE.HARVESTED, timer: 12.5 });
  return d;
}

test('packed cells keep material and signed density', () => {
  for (const density of [-127, -1, 0, 1, 64, 127]) {
    const packed = packCell(MAT.SAND, density);
    assert.equal(unpackMaterial(packed), MAT.SAND);
    assert.equal(unpackDensity(packed), density);
  }
});

test('a chunk delta survives an encode/decode round trip', () => {
  const original = sampleDelta();
  const decoded = decodeChunkDelta(encodeChunkDelta(original));
  assert.equal(decoded.cx, -3);
  assert.equal(decoded.cz, 12);
  assert.deepEqual(decoded.cells, original.cells);
  assert.deepEqual(decoded.pieces, original.pieces);
  assert.deepEqual(decoded.harvest, original.harvest);
});

test('an empty delta encodes to a tiny buffer', () => {
  const d = new ChunkDelta(0, 0);
  assert.equal(d.isEmpty, true);
  assert.equal(encodeChunkDelta(d).byteLength, 28);
  assert.equal(decodeChunkDelta(encodeChunkDelta(d)).isEmpty, true);
});

test('each edited cell costs 4 bytes', () => {
  const d = new ChunkDelta(0, 0);
  for (let i = 0; i < 1000; i++) d.setCell(i, MAT.AIR, -127);
  assert.equal(encodeChunkDelta(d).byteLength, 28 + 4000);
});

test('bad data is rejected with a clear error', () => {
  const good = encodeChunkDelta(sampleDelta());
  const wrongMagic = good.slice(0);
  new DataView(wrongMagic).setUint32(0, 0xdeadbeef, true);
  assert.throws(() => decodeChunkDelta(wrongMagic), SaveFormatError);

  const newer = good.slice(0);
  new DataView(newer).setUint16(4, CHUNK_FORMAT_VERSION + 1, true);
  assert.throws(() => decodeChunkDelta(newer), /newer than this game/);

  assert.throws(() => decodeChunkDelta(good.slice(0, good.byteLength - 3)), /truncated/);
  assert.throws(() => decodeChunkDelta(new ArrayBuffer(4)), /truncated/);
});

test('world metadata is checked before loading', () => {
  const meta = makeWorldMeta({ worldId: 'w', seed: 'w', generatorVersion: 1, player: {}, inventory: {}, timeOfDay: 0.3 });
  assert.equal(metaProblem(meta, 1), null);
  assert.match(metaProblem(meta, 2), /older world generator/);
  assert.match(metaProblem({ ...meta, formatVersion: 99 }, 1), /newer version/);
  assert.match(metaProblem(null, 1), /missing or damaged/);
});
