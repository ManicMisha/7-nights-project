// IndexedDB persistence for saves. One database, two object stores:
//   worlds — world metadata (player, inventory, time), keyed by worldId;
//   chunks — encoded ChunkDelta buffers, keyed by "worldId|cx,cz".
// Every save writes the metadata and all changed chunks in a single
// transaction, so a save is never half-written.

const DB_NAME = '7nights';
const DB_VERSION = 1;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save transaction aborted'));
  });
}

export class WorldStorage {
  constructor(db) {
    this.db = db;
  }

  /** Opens the database, or resolves to null if IndexedDB is unavailable. */
  static async open() {
    try {
      if (typeof indexedDB === 'undefined') return null;
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'worldId' });
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'key' });
          chunks.createIndex('byWorld', 'worldId');
        }
      };
      return new WorldStorage(await request(req));
    } catch (err) {
      console.warn('Saving unavailable:', err);
      return null;
    }
  }

  /** Loads a world's metadata and chunk buffers (meta is null for a new world). */
  async loadWorld(worldId) {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readonly');
    const meta = await request(tx.objectStore('worlds').get(worldId));
    const rows = await request(tx.objectStore('chunks').index('byWorld').getAll(worldId));
    return { meta: meta || null, chunks: rows.map((r) => r.data) };
  }

  /** Writes metadata plus the given chunks ({ cx, cz, data: ArrayBuffer | null }). null deletes. */
  async saveWorld(meta, chunks) {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').put(meta);
    const store = tx.objectStore('chunks');
    for (const { cx, cz, data } of chunks) {
      const key = `${meta.worldId}|${cx},${cz}`;
      if (data) store.put({ key, worldId: meta.worldId, data });
      else store.delete(key);
    }
    await done(tx);
  }

  /** Deletes a world and all of its chunks. */
  async deleteWorld(worldId) {
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(worldId);
    const index = tx.objectStore('chunks').index('byWorld');
    const keys = await request(index.getAllKeys(worldId));
    for (const key of keys) tx.objectStore('chunks').delete(key);
    await done(tx);
  }
}
