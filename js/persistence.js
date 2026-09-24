// Save orchestration: loads a world's save before the first chunks
// generate, restores the player afterwards, autosaves while playing, and
// saves when the tab is hidden or the game is paused.
//
// A world is identified by its seed, so ?seed=abc always returns to the
// same world. Without ?seed the last world played is resumed.

import { GENERATOR_VERSION } from './worldgen.js';
import { chunkKey } from './chunk.js';
import { WorldStorage } from './storage.js';
import { decodeChunkDelta, makeWorldMeta, metaProblem } from './save.js';
import { PLAYER, WORLD_HEIGHT } from './config.js';

const LAST_WORLD_KEY = '7nights.lastWorld';
const AUTOSAVE_SECONDS = 30;

/** The world id to open: ?seed, then the last world played, then a new random one. */
export function resolveWorldId(search, storage = safeLocalStorage()) {
  const params = new URLSearchParams(search);
  if (params.get('seed')) return params.get('seed');
  if (params.has('bench')) return 'demo'; // benchmarks always use the same world
  const last = storage?.getItem(LAST_WORLD_KEY);
  return last || String(Math.floor(Math.random() * 1e9));
}

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class SaveManager {
  constructor(game) {
    this.game = game;
    this.worldId = game.seedText;
    this.enabled = !game.benchOptions; // benchmarks never read or write saves
    this.storage = null;
    this.ready = false; // true once any existing save has been read
    this.restored = null; // saved world metadata to apply after loading
    this.notice = ''; // message for the player about the save, if any
    this.lastSavedAt = 0;
    this.saving = null;
    this.autosaveTimer = 0;
    this.deleted = false;
  }

  /** Opens storage and reads this world's save (if any). */
  async load() {
    if (!this.enabled) {
      this.ready = true;
      return;
    }
    try {
      safeLocalStorage()?.setItem(LAST_WORLD_KEY, this.worldId);
    } catch {
      /* not critical */
    }
    this.storage = await WorldStorage.open();
    if (!this.storage) {
      this.notice = "Saving isn't available in this browser (private browsing?). Progress won't be kept.";
      this.ready = true;
      return;
    }
    try {
      const { meta, chunks } = await this.storage.loadWorld(this.worldId);
      if (meta) {
        const problem = metaProblem(meta, GENERATOR_VERSION);
        if (problem) {
          this.notice = `${problem} Starting a fresh world; the old save will be replaced.`;
        } else {
          const deltas = [];
          for (const buffer of chunks) {
            try {
              deltas.push(decodeChunkDelta(buffer));
            } catch (err) {
              console.warn('Skipping a damaged chunk in the save:', err);
            }
          }
          this.game.world.loadDeltas(deltas);
          this.restored = meta;
        }
      }
    } catch (err) {
      console.warn('Could not read the save:', err);
      this.notice = "Your save couldn't be read. Starting a fresh world.";
    }
    this.ready = true;
  }

  /** World position to stream in first: the saved player position, or the origin. */
  get loadCenter() {
    const p = this.restored?.player?.position;
    return Array.isArray(p) ? { x: p[0], z: p[2] } : { x: 0.5, z: 0.5 };
  }

  /** Applies the saved player, inventory and time. Returns false for a new world. */
  applyRestored() {
    const meta = this.restored;
    if (!meta) return false;
    const g = this.game;
    const p = g.player;
    const s = meta.player || {};
    if (Array.isArray(s.spawn)) p.spawnPoint.set(...s.spawn);
    if (Array.isArray(s.position)) p.position.set(...s.position);
    else p.position.copy(p.spawnPoint);
    p.yaw = Number(s.yaw) || 0;
    p.pitch = Number(s.pitch) || 0;
    p.flying = Boolean(s.flying);
    p.velocity.set(0, 0, 0);
    // Never restore the player inside the ground.
    while (p.position.y < WORLD_HEIGHT && g.world.isSolid(Math.floor(p.position.x), Math.floor(p.position.y), Math.floor(p.position.z))) {
      p.position.y += 1;
    }
    const health = Number(s.health);
    if (health > 0) p.health = Math.min(PLAYER.maxHealth, health);
    else p.respawn();
    if (meta.inventory) g.inventory.load(meta.inventory);
    if (Number.isFinite(meta.timeOfDay)) g.cycle.time = meta.timeOfDay;
    return true;
  }

  /** Autosave clock; call every frame with the simulation time step. */
  update(dt) {
    if (!this.storage) return;
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      this.save();
    }
  }

  snapshot() {
    const g = this.game;
    const p = g.player;
    return makeWorldMeta({
      worldId: this.worldId,
      seed: g.seedText,
      generatorVersion: GENERATOR_VERSION,
      player: {
        position: p.position.toArray(),
        spawn: p.spawnPoint.toArray(),
        yaw: p.yaw,
        pitch: p.pitch,
        health: p.health,
        flying: p.flying,
      },
      inventory: g.inventory.toJSON(),
      timeOfDay: g.cycle.time,
    });
  }

  /** Writes the player state and every changed chunk. Safe to call often. */
  save() {
    if (!this.storage || !this.ready || this.deleted || this.game.state === 'loading') return Promise.resolve();
    if (this.saving) return this.saving;
    const chunks = this.game.world.takeUnsavedChunks();
    const meta = this.snapshot();
    this.saving = this.storage.saveWorld(meta, chunks)
      .then(() => {
        this.lastSavedAt = meta.savedAt;
      })
      .catch((err) => {
        console.warn('Saving failed:', err);
        this.notice = 'Saving failed. The game will try again shortly.';
        // Put the chunks back so the next save retries them.
        for (const c of chunks) this.game.world.unsaved.add(chunkKey(c.cx, c.cz));
      })
      .finally(() => {
        this.saving = null;
        this.game.updateSaveStatus();
      });
    return this.saving;
  }

  /** Deletes this world's save; the page should reload afterwards. */
  async deleteWorld() {
    this.deleted = true;
    if (this.saving) await this.saving;
    if (this.storage) await this.storage.deleteWorld(this.worldId);
  }

  get statusText() {
    if (!this.enabled) return 'Benchmark mode: saving is off.';
    if (this.notice) return this.notice;
    if (!this.storage) return '';
    if (!this.lastSavedAt) return this.restored ? 'Loaded your saved world.' : 'New world. It saves automatically.';
    return `Saved at ${new Date(this.lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
  }
}
