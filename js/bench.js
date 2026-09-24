// Benchmark mode (`?bench`). Flies the camera along a fixed route over a
// fixed seed at a fixed time of day and reports frame-time statistics, so
// runs on different machines and different versions can be compared.
//
//   ?bench            40 s run at noon on seed "demo"
//   ?bench=60         60 s run
//   ?bench&time=0.8   run at another time of day (0 = midnight, 0.5 = noon)
//   ?bench&seed=abc   run on another seed

import { SEA_LEVEL } from './config.js';

export const BENCH_DEFAULTS = {
  seconds: 40,
  warmupSeconds: 3, // streaming settles; frames aren't recorded
  time: 0.5,
  speed: 10, // metres per second along the route
};

/** A closed loop (x, z) the camera follows, starting at the world origin. */
export const BENCH_ROUTE = [[0, 0], [160, 0], [160, 160], [0, 160]];

/** Parses benchmark options from a query string; null when not benchmarking. */
export function parseBenchOptions(search = '') {
  const params = new URLSearchParams(search);
  if (!params.has('bench')) return null;
  const seconds = Number(params.get('bench'));
  const time = Number(params.get('time'));
  return {
    ...BENCH_DEFAULTS,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : BENCH_DEFAULTS.seconds,
    time: params.has('time') && Number.isFinite(time) ? ((time % 1) + 1) % 1 : BENCH_DEFAULTS.time,
  };
}

/**
 * Frame-time summary. `onePercentLowFps` is the average frame rate of the
 * slowest 1% of frames — the stutter a player actually notices.
 */
export function summarizeFrames(frameMs) {
  const n = frameMs.length;
  if (n === 0) return null;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const total = frameMs.reduce((s, v) => s + v, 0);
  const pct = (p) => sorted[Math.min(n - 1, Math.floor(p * (n - 1)))];
  const worst = sorted.slice(Math.floor(n * 0.99));
  const worstAvg = worst.reduce((s, v) => s + v, 0) / worst.length;
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  return {
    frames: n,
    avgFps: round(1000 / (total / n)),
    onePercentLowFps: round(1000 / worstAvg),
    p50Ms: round(pct(0.5), 2),
    p95Ms: round(pct(0.95), 2),
    maxMs: round(sorted[n - 1], 2),
  };
}

/** Point on the looped route after travelling `distance` metres. */
export function routePoint(distance, route = BENCH_ROUTE) {
  const segs = route.map((p, i) => {
    const q = route[(i + 1) % route.length];
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const loop = segs.reduce((s, g) => s + g.len, 0);
  let d = ((distance % loop) + loop) % loop;
  for (const g of segs) {
    if (d <= g.len) {
      const t = d / g.len;
      return [g.p[0] + (g.q[0] - g.p[0]) * t, g.p[1] + (g.q[1] - g.p[1]) * t];
    }
    d -= g.len;
  }
  return route[0];
}

export class Benchmark {
  constructor(game, options) {
    this.game = game;
    this.options = options;
    this.elapsed = 0;
    this.frameMs = [];
    this.drawCalls = 0;
    this.done = false;
    this.panel = document.createElement('div');
    this.panel.id = 'bench-panel';
    document.body.appendChild(this.panel);
  }

  start() {
    const g = this.game;
    g.mobs.enabled = false;
    g.player.flying = true;
    this.lastLabel = '';
    this.place(0);
  }

  /** Called every frame with the real (uncapped) frame time in seconds. */
  update(rawDt) {
    if (this.done) return;
    this.elapsed += rawDt;
    const { warmupSeconds, seconds } = this.options;
    const recording = this.elapsed > warmupSeconds;
    if (recording) {
      this.frameMs.push(rawDt * 1000);
      this.drawCalls += this.game.renderer.info.render.calls;
    }
    this.place(this.elapsed * this.options.speed);

    const label = recording
      ? `Benchmark running… ${Math.ceil(warmupSeconds + seconds - this.elapsed)} s`
      : 'Benchmark warming up…';
    if (label !== this.lastLabel) {
      this.panel.textContent = label;
      this.lastLabel = label;
    }
    if (this.elapsed >= warmupSeconds + seconds) this.finish();
  }

  /** Puts the camera on the route, cruising above the terrain ahead. */
  place(distance) {
    const g = this.game;
    const [x, z] = routePoint(distance);
    let ground = SEA_LEVEL;
    for (let ahead = 0; ahead <= 24; ahead += 8) {
      const [ax, az] = routePoint(distance + ahead);
      ground = Math.max(ground, g.generator.columnInfo(Math.floor(ax), Math.floor(az)).height);
    }
    const [lx, lz] = routePoint(distance + 12);
    const p = g.player;
    p.position.set(x, Math.max(ground + 8, SEA_LEVEL + 10), z);
    p.velocity.set(0, 0, 0);
    p.yaw = Math.atan2(-(lx - x), -(lz - z));
    p.pitch = -0.18;
    g.cycle.time = this.options.time;
  }

  finish() {
    this.done = true;
    const g = this.game;
    const stats = g.world.collectStats();
    const summary = summarizeFrames(this.frameMs);
    const result = {
      ...summary,
      avgDrawCalls: Math.round(this.drawCalls / Math.max(1, this.frameMs.length)),
      meshedChunks: stats.meshed,
      worldTriangles: Math.round(stats.triangles),
      seconds: this.options.seconds,
      timeOfDay: this.options.time,
      seed: g.seedText,
      renderDistance: g.world.renderDistance,
      waterReflections: g.water.reflections,
      resolution: `${g.renderer.domElement.width}×${g.renderer.domElement.height}`,
      pixelRatio: g.renderer.getPixelRatio(),
      gpu: gpuName(g.renderer),
      userAgent: navigator.userAgent,
      threeRevision: g.threeRevision,
    };
    window.benchResult = result;
    console.info('7 Nights benchmark', result);
    this.showResult(result);
  }

  showResult(r) {
    const panel = this.panel;
    panel.classList.add('done');
    panel.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = 'Benchmark results';
    const table = document.createElement('dl');
    const rows = [
      ['Average FPS', r.avgFps],
      ['1% low FPS', r.onePercentLowFps],
      ['Frame time p50 / p95 / max', `${r.p50Ms} / ${r.p95Ms} / ${r.maxMs} ms`],
      ['Draw calls per frame', r.avgDrawCalls],
      ['Resolution', `${r.resolution} (pixel ratio ${r.pixelRatio})`],
      ['Render distance', `${r.renderDistance} chunks`],
      ['GPU', r.gpu],
    ];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = String(v);
      table.append(dt, dd);
    }
    const copy = document.createElement('button');
    copy.textContent = 'Copy results';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed — see the browser console';
      }
    });
    const again = document.createElement('button');
    again.textContent = 'Run again';
    again.addEventListener('click', () => location.reload());
    panel.append(title, table, copy, again);
  }
}

function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {
    return 'unknown';
  }
}
