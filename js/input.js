// Keyboard / mouse / pointer-lock state with a tiny event hook system.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.locked = false;
    this.handlers = { keydown: [], mousedown: [], wheel: [], lockchange: [] };
    this.lastSpace = 0;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (this.locked && e.code === 'Space')) e.preventDefault();
      if (!e.repeat) this.emit('keydown', e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.emit('mousedown', e);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.emit('wheel', e);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
      this.emit('lockchange', this.locked);
    });
  }

  on(type, fn) {
    this.handlers[type].push(fn);
  }

  emit(type, arg) {
    for (const fn of this.handlers[type]) fn(arg);
  }

  lock() {
    const req = this.canvas.requestPointerLock();
    // Some browsers return a promise that rejects if called too soon after an unlock.
    if (req && req.catch) req.catch(() => {});
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  consumeMouse() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
