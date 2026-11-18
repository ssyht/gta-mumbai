import type { GameRenderer } from '../render/Renderer';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/**
 * On-screen perf HUD that enforces the CLAUDE.md §7 budgets: FPS, frame ms,
 * draw calls (≤1,500), triangles (≤3M), JS memory, backend, resolution scale.
 */
export const BUDGET = { drawCalls: 1500, triangles: 3_000_000 } as const;

export interface PerfSample {
  fps: number;
  frameMs: number;
  worstMs: number;
  drawCalls: number;
  triangles: number;
  memoryMb: number | null;
  physicsMs: number;
}

export class PerfHud {
  readonly el: HTMLElement;
  visible = true;
  last: PerfSample = {
    fps: 0,
    frameMs: 0,
    worstMs: 0,
    drawCalls: 0,
    triangles: 0,
    memoryMb: null,
    physicsMs: 0,
  };
  private frames = 0;
  private acc = 0;
  private worst = 0;

  constructor(
    parent: HTMLElement,
    private readonly gr: GameRenderer,
    private readonly physics: PhysicsWorld,
    private readonly presetLabel: () => string,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    parent.appendChild(this.el);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  update(frameMs: number): void {
    this.frames++;
    this.acc += frameMs;
    this.worst = Math.max(this.worst, frameMs);
    if (this.acc < 250) return;
    const info = this.gr.renderer.info.render;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.last = {
      fps: (this.frames * 1000) / this.acc,
      frameMs: this.acc / this.frames,
      worstMs: this.worst,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      memoryMb: mem ? mem.usedJSHeapSize / 1048576 : null,
      physicsMs: this.physics.lastStepMs,
    };
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
    if (!this.visible) return;
    const s = this.last;
    const target = this.gr.quality.targetFps;
    const cls = (bad: boolean, warn = false): string => (bad ? 'bad' : warn ? 'warn' : 'ok');
    const canvas = this.gr.renderer.domElement;
    this.el.innerHTML = [
      `<b class="${cls(s.fps < target * 0.75, s.fps < target * 0.95)}">${s.fps.toFixed(0)} FPS</b> ${s.frameMs.toFixed(1)} ms (worst ${s.worstMs.toFixed(0)})`,
      `draw <span class="${cls(s.drawCalls > BUDGET.drawCalls)}">${s.drawCalls}</span> · tris <span class="${cls(s.triangles > BUDGET.triangles)}">${(s.triangles / 1e6).toFixed(2)}M</span>`,
      `mem ${s.memoryMb === null ? 'n/a' : s.memoryMb.toFixed(0) + ' MB'} · physics ${s.physicsMs.toFixed(2)} ms · bodies ${this.physics.world.bodies.len()}`,
      `${this.gr.backend} · ${this.presetLabel()} · ${canvas.width}×${canvas.height} @ ${(this.gr.scale * 100).toFixed(0)}%`,
    ].join('<br>');
  }
}
