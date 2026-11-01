/** Hand-rolled FPS / frame-time / memory readout (no stats.js dependency). */
export class Stats {
  private el: HTMLElement;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  private last = performance.now();
  private fps = 0;
  private ms = 0;
  extra: Record<string, string | number> = {};

  constructor(elId = 'stats') {
    const el = document.getElementById(elId);
    if (!el) throw new Error(`Stats: #${elId} not found`);
    this.el = el;
  }

  /** Call once per rendered frame. Returns delta seconds (clamped). */
  tick(): number {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.frames++;
    this.acc += dt;
    if (dt > this.worst) this.worst = dt;

    if (this.acc >= 500) {
      this.fps = (this.frames * 1000) / this.acc;
      this.ms = this.acc / this.frames;
      this.render();
      this.frames = 0;
      this.acc = 0;
      this.worst = 0;
    }
    // Clamp to avoid physics explosions after a tab stall.
    return Math.min(dt / 1000, 1 / 20);
  }

  private render() {
    const fps = this.fps.toFixed(0).padStart(3);
    const ms = this.ms.toFixed(1).padStart(4);
    const peak = this.worst.toFixed(0).padStart(3);
    const lines = [`<b>${fps} fps</b>  ${ms} ms  peak ${peak}`];
    // Chrome-only heap reading; absent elsewhere.
    const mem = (performance as any).memory;
    if (mem) {
      const mb = (mem.usedJSHeapSize / 1048576).toFixed(0);
      const cap = (mem.jsHeapSizeLimit / 1048576).toFixed(0);
      lines.push(`heap ${mb} / ${cap} MB`);
    }
    for (const [k, v] of Object.entries(this.extra)) lines.push(`${k} ${v}`);
    this.el.innerHTML = lines.join('\n');
  }
}
