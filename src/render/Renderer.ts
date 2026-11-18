import * as THREE from 'three/webgpu';
import type { QualityConfig } from '../core/Settings';

export type Backend = 'WebGPU' | 'WebGL2';

/**
 * WebGPURenderer with automatic WebGL2 fallback (CLAUDE.md §5). Owns pixel
 * ratio and dynamic resolution scaling, which holds the frame-rate target on
 * every preset (§4A.5).
 */
export class GameRenderer {
  readonly renderer: THREE.WebGPURenderer;
  readonly backend: Backend;
  quality: QualityConfig;
  /** Dynamic resolution scale, 1 = native (capped) pixel ratio. */
  scale = 1;
  dynamicEnabled = true;

  private emaMs = 16.7;
  private evalTimer = 0;
  private goodTime = 0;
  private cooldown = 0;

  private constructor(renderer: THREE.WebGPURenderer, quality: QualityConfig) {
    this.renderer = renderer;
    this.quality = quality;
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    this.backend = backend ? 'WebGPU' : 'WebGL2';
  }

  static async create(
    canvas: HTMLCanvasElement,
    quality: QualityConfig,
    forceWebGL: boolean,
  ): Promise<GameRenderer> {
    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: false,
      forceWebGL,
      powerPreference: 'high-performance',
    });
    await renderer.init();
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    const gr = new GameRenderer(renderer, quality);
    gr.resize(window.innerWidth, window.innerHeight);
    return gr;
  }

  get basePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(this.basePixelRatio * this.scale);
    this.renderer.setSize(width, height, false);
  }

  /** Call once per frame with the real frame time (ms). */
  updateDynamicResolution(frameMs: number, dt: number): void {
    if (frameMs > 100) return; // tab switch or hitch, not a perf signal
    this.emaMs += (frameMs - this.emaMs) * 0.08;
    if (!this.dynamicEnabled) {
      if (this.scale !== 1) this.setScale(1);
      return;
    }
    const target = 1000 / this.quality.targetFps;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.evalTimer += dt;
    if (this.evalTimer < 1) return;
    this.evalTimer = 0;
    if (this.emaMs > target * 1.12 && this.scale > this.quality.minResolutionScale) {
      this.setScale(Math.max(this.quality.minResolutionScale, this.scale - 0.1));
      this.goodTime = 0;
      this.cooldown = 8;
    } else if (this.emaMs < target * 1.04 && this.scale < 1) {
      this.goodTime += 1;
      if (this.goodTime >= 4 && this.cooldown === 0) {
        this.setScale(Math.min(1, this.scale + 0.05));
        this.goodTime = 0;
      }
    } else {
      this.goodTime = 0;
    }
  }

  private setScale(s: number): void {
    this.scale = Math.round(s * 100) / 100;
    this.renderer.setPixelRatio(this.basePixelRatio * this.scale);
  }

  get frameMsAverage(): number {
    return this.emaMs;
  }
}
