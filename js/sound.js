// Tiny procedural sound effects via the Web Audio API (no audio files).

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  burst({ duration = 0.12, freq = 800, q = 1, gain = 0.6, type = 'lowpass' }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3, duration);
  }

  tone({ freq = 220, to = freq, duration = 0.2, gain = 0.3, type = 'sine' }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  dig() {
    this.burst({ duration: 0.14, freq: 500 + Math.random() * 500, q: 0.8 });
  }

  place() {
    this.burst({ duration: 0.09, freq: 350, q: 1.5, gain: 0.7 });
  }

  hit() {
    this.burst({ duration: 0.08, freq: 1500, type: 'bandpass', q: 2, gain: 0.8 });
    this.tone({ freq: 160, to: 90, duration: 0.12, gain: 0.25, type: 'square' });
  }

  hurt() {
    this.tone({ freq: 320, to: 180, duration: 0.18, gain: 0.3, type: 'sawtooth' });
  }

  groan() {
    this.tone({ freq: 90 + Math.random() * 30, to: 60, duration: 0.7, gain: 0.12, type: 'sawtooth' });
  }
}
