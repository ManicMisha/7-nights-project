// Entry point: wires the modules together and runs the game loop.

import * as THREE from 'three';
import { DEFAULT_SETTINGS, CHUNK_SIZE } from './config.js';
import { hashSeed } from './noise.js';
import { BLOCK_NAME } from './blocks.js';
import { TextureLibrary } from './textures.js';
import { sharedUniforms, createTerrainMaterial, createWaterMaterial } from './shaders.js';
import { TerrainGenerator, BIOME_NAME } from './worldgen.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Inventory } from './inventory.js';
import { BlockInteraction } from './interaction.js';
import { MobManager } from './mobs.js';
import { DayNightCycle } from './sky.js';
import { WaterRenderer } from './water.js';
import { UI } from './ui.js';
import { Sound } from './sound.js';
import { resolveFlags } from './flags.js';
import { parseBenchOptions, Benchmark } from './bench.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = '7nights.settings';

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

function resolveSeed() {
  const params = new URLSearchParams(location.search);
  if (params.get('seed')) return params.get('seed');
  // Benchmarks default to a fixed world so runs are comparable.
  if (params.has('bench')) return 'demo';
  return String(Math.floor(Math.random() * 1e9));
}

class Game {
  constructor() {
    this.canvas = $('game');
    this.settings = loadSettings();
    this.seedText = resolveSeed();
    const { flags, unknown } = resolveFlags(location.search);
    this.flags = flags;
    if (unknown.length) console.warn(`Unknown feature flags ignored: ${unknown.join(', ')}`);
    this.benchOptions = parseBenchOptions(location.search);
    this.bench = null;
    this.threeRevision = THREE.REVISION;
    this.state = 'loading'; // loading | menu | playing | inventory | dead
    this.timer = new THREE.Timer();
    this.timer.connect(document); // resets the delta after the tab was hidden
    this.fps = 0;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.groanTimer = 5;

    const gl2 = this.canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
    if (!gl2) throw new Error('This game needs WebGL 2, which your browser or GPU does not provide.');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context: gl2, antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    // Count draw calls across all passes of a frame, not just the last one.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 1000);

    this.textures = new TextureLibrary();
    this.materials = {
      terrain: createTerrainMaterial(this.textures.array),
      water: createWaterMaterial(),
    };

    this.generator = new TerrainGenerator(hashSeed(this.seedText));
    this.world = new World(this.scene, this.generator, this.materials);
    this.world.setRenderDistance(this.settings.renderDistance);

    this.input = new Input(this.canvas);
    this.player = new Player(this.camera, this.world);
    this.player.sensitivity = this.settings.sensitivity;
    this.inventory = new Inventory();
    this.inventory.giveStarterKit();
    this.cycle = new DayNightCycle(this.scene);
    this.cycle.dayLength = this.settings.dayLengthMinutes * 60;
    this.sound = new Sound();
    this.mobs = new MobManager(this.scene, this.world, this.player, this.cycle);
    this.interaction = new BlockInteraction(this.scene, this.world, this.player, this.inventory, this.mobs, this.textures, this.sound);
    this.water = new WaterRenderer(this.renderer, this.scene, this.camera, this.world, this.materials.water);
    this.water.reflections = this.settings.waterReflections;
    this.ui = new UI(this.textures, this.inventory);

    this.bindEvents();
    this.bindMenu();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  get fogFar() {
    return this.world.renderDistance * CHUNK_SIZE;
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water.setSize(size.x, size.y);
  }

  // -------------------------------------------------------------------------
  // State & events
  // -------------------------------------------------------------------------

  setState(state) {
    this.state = state;
    $('loading').hidden = state !== 'loading';
    $('menu').hidden = state !== 'menu';
    $('inventory-screen').hidden = state !== 'inventory';
    $('death').hidden = state !== 'dead';
    $('hud').hidden = state === 'loading';
    $('play').textContent = this.started ? 'Resume' : 'Play';
  }

  play() {
    this.sound.unlock();
    this.started = true;
    this.input.lock();
  }

  bindEvents() {
    const input = this.input;
    input.on('lockchange', (locked) => {
      if (locked) {
        this.setState('playing');
      } else if (this.state === 'playing') {
        this.setState('menu');
      }
    });

    input.on('keydown', (e) => {
      if (e.code === 'KeyE' && (this.state === 'playing' || this.state === 'inventory')) {
        this.toggleInventory();
        return;
      }
      if (e.code === 'Escape' && this.state === 'inventory') {
        this.toggleInventory();
        return;
      }
      if (this.state !== 'playing') return;
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.inventory.select(n - 1);
      } else if (e.code === 'F3') {
        e.preventDefault();
        this.ui.toggleDebug();
      } else if (e.code === 'KeyF') {
        this.player.toggleFlight();
        this.ui.toast(this.player.flying ? 'Flying enabled' : 'Flying disabled');
      } else if (e.code === 'Space') {
        const now = performance.now();
        if (now - input.lastSpace < 300) {
          this.player.toggleFlight();
          this.ui.toast(this.player.flying ? 'Flying enabled' : 'Flying disabled');
          input.lastSpace = 0;
        } else {
          input.lastSpace = now;
        }
      }
    });

    input.on('wheel', (e) => {
      if (this.state !== 'playing') return;
      this.inventory.select(this.inventory.selected + (e.deltaY > 0 ? 1 : -1));
    });

    input.on('mousedown', (e) => {
      if (this.state === 'playing') this.interaction.onMouseDown(e.button);
    });

    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !input.locked && !this.bench) this.play();
    });

    this.player.onDamage = () => {
      this.ui.flashDamage();
      this.sound.hurt();
    };
    this.player.onDeath = () => {
      this.setState('dead');
      this.input.unlock();
    };
  }

  toggleInventory() {
    if (this.state === 'inventory') {
      this.ui.closeInventory();
      this.state = 'playing'; // so a failed re-lock falls back to the menu
      this.input.lock();
      setTimeout(() => {
        if (!this.input.locked && this.state === 'playing') this.setState('menu');
      }, 400);
    } else {
      this.setState('inventory');
      this.input.unlock();
    }
  }

  bindMenu() {
    const s = this.settings;
    const bindRange = (id, outId, key, format, apply) => {
      const el = $(id);
      el.value = s[key];
      $(outId).textContent = format(s[key]);
      el.addEventListener('input', () => {
        s[key] = Number(el.value);
        $(outId).textContent = format(s[key]);
        apply(s[key]);
        saveSettings(s);
      });
    };
    bindRange('render-distance', 'rd-out', 'renderDistance', (v) => `${v} chunks`, (v) => this.world.setRenderDistance(v));
    bindRange('fov', 'fov-out', 'fov', (v) => `${v}°`, (v) => {
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
    });
    bindRange('sensitivity', 'sens-out', 'sensitivity', (v) => v.toFixed(1), (v) => {
      this.player.sensitivity = v;
    });

    const day = $('day-length');
    day.value = String(s.dayLengthMinutes);
    day.addEventListener('change', () => {
      s.dayLengthMinutes = Number(day.value);
      this.cycle.dayLength = s.dayLengthMinutes * 60;
      saveSettings(s);
    });

    const refl = $('reflections');
    refl.checked = s.waterReflections;
    refl.addEventListener('change', () => {
      s.waterReflections = refl.checked;
      this.water.reflections = refl.checked;
      saveSettings(s);
    });

    const mobsToggle = $('mobs-enabled');
    mobsToggle.addEventListener('change', () => {
      this.mobs.enabled = mobsToggle.checked;
      if (!mobsToggle.checked) this.mobs.clear();
    });

    $('set-day').addEventListener('click', () => { this.cycle.time = 0.3; });
    $('set-night').addEventListener('click', () => { this.cycle.time = 0.8; });

    $('seed').value = this.seedText;
    $('new-world').addEventListener('click', () => {
      const seed = $('seed').value.trim() || String(Math.floor(Math.random() * 1e9));
      const url = new URL(location.href);
      url.searchParams.set('seed', seed);
      location.href = url.toString();
    });

    $('play').addEventListener('click', () => this.play());
    $('respawn').addEventListener('click', () => {
      this.player.respawn();
      this.mobs.clear();
      this.play();
    });
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  /** Streams the spawn area in with a generous budget before play starts. */
  updateLoading() {
    this.world.frameBudgetMs = 40;
    const done = this.world.update(0.5, 0.5);
    const needed = this.world.ringOffsets.filter((o) => o.d <= 3).length;
    const meshed = this.world.ringOffsets.filter((o) => o.d <= 3 && this.world.getChunk(o.dx, o.dz)?.meshed).length;
    $('progress-bar').style.width = `${Math.round((meshed / needed) * 100)}%`;
    if (meshed >= needed || done) {
      this.world.frameBudgetMs = 7;
      this.player.spawnAt(0, 0);
      if (this.benchOptions) this.startBenchmark();
      else this.setState('menu');
    }
  }

  /** Skips the menu and flies the fixed benchmark route (see bench.js). */
  startBenchmark() {
    this.bench = new Benchmark(this, this.benchOptions);
    this.bench.start();
    this.setState('playing');
  }

  frame(time) {
    this.timer.update(time);
    const rawDt = this.timer.getDelta();
    const dt = Math.min(0.05, rawDt);
    this.updateFps(dt);

    if (this.state === 'loading') {
      this.updateLoading();
      return;
    }

    const simulate = this.state === 'playing' || this.state === 'inventory';
    const simDt = simulate ? dt : 0;
    const controls = this.state === 'playing' && this.input.locked;

    if (this.bench) this.bench.update(rawDt);
    this.world.update(this.player.position.x, this.player.position.z);
    this.player.update(simDt, this.input, controls);
    this.interaction.update(simDt, this.input, controls);
    this.mobs.update(simDt);
    this.cycle.update(simDt, this.camera, this.fogFar);
    sharedUniforms.uTime.value += dt;
    sharedUniforms.uUnderwater.value = this.player.headInWater ? 1 : 0;
    this.cycle.clouds.visible = !this.player.headInWater;

    this.groanTimer -= simDt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 4 + Math.random() * 6;
      const near = this.mobs.mobs.some((m) => m.position.distanceTo(this.player.position) < 16);
      if (near) this.sound.groan();
    }

    this.render();
    this.ui.update(dt, {
      health: this.player.health,
      underwater: this.player.headInWater,
      clock: this.cycle.clock,
      night: this.cycle.isNight,
      flying: this.player.flying,
      debugText: () => this.debugText(),
    });
  }

  render() {
    this.renderer.info.reset();
    this.water.render();
    this.renderer.render(this.scene, this.camera);
  }

  updateFps(dt) {
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
  }

  debugText() {
    const p = this.player.position;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    const light = this.world.getLight(bx, by, bz);
    const stats = this.world.collectStats();
    const info = this.generator.columnInfo(bx, bz);
    const target = this.interaction.target;
    const info3 = this.renderer.info.render;
    return [
      `7 Nights  ${this.fps} fps`,
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Chunk: ${bx >> 4}, ${bz >> 4}   Biome: ${BIOME_NAME[info.biome]}`,
      `Light: sky ${light >> 4}  block ${light & 15}`,
      `Chunks: ${stats.meshed} meshed / ${stats.chunks} loaded`,
      `Triangles (world): ${Math.round(stats.triangles).toLocaleString()}`,
      `Draw calls (frame): ${info3.calls}`,
      `Mobs: ${this.mobs.mobs.length}   Kills: ${this.mobs.kills}`,
      `Time: ${this.cycle.clock}   Seed: ${this.seedText}`,
      `Three.js r${this.threeRevision}   Flags: ${Object.entries(this.flags).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none'}`,
      `Target: ${target ? `${BLOCK_NAME[target.id]} @ ${target.x}, ${target.y}, ${target.z}` : '-'}`,
    ].join('\n');
  }
}

try {
  window.game = new Game();
} catch (err) {
  console.error(err);
  $('loading').hidden = true;
  $('error').hidden = false;
  $('error-text').textContent = err.message;
}
