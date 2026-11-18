import * as THREE from 'three/webgpu';
import {
  builtinAOContext,
  convertToTexture,
  mrt,
  normalView,
  screenUV,
  dot,
  float,
  fract,
  length,
  mix,
  pass,
  pow,
  renderOutput,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import type { QualityConfig } from '../core/Settings';
import type { GradeKey } from './sky/lightingCurves';

/**
 * Native TSL post stack on WebGPURenderer (never the old EffectComposer):
 * HDR scene pass → bloom → time-of-day grade (tint, split-tone, saturation,
 * contrast) → vignette → AgX tone mapping → film grain → FXAA (Low/Medium).
 *
 * The grade is a keyframed stand-in for M2.5's 3D LUT blending. Grading and
 * tone mapping are never turned off.
 */
export class PostFX {
  readonly pipeline: THREE.RenderPipeline;
  readonly u = {
    tint: uniform(new THREE.Vector3(1, 1, 1)),
    shadowTint: uniform(new THREE.Vector3(1, 1, 1)),
    highlightTint: uniform(new THREE.Vector3(1, 1, 1)),
    saturation: uniform(1),
    contrast: uniform(1),
    vignette: uniform(0.28),
    grain: uniform(0.025),
  };
  private bloomNode: ReturnType<typeof bloom> | null = null;
  private bloomScale = 1;

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    quality: QualityConfig,
  ) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.build(scene, camera, quality);
  }

  build(scene: THREE.Scene, camera: THREE.Camera, quality: QualityConfig): void {
    const u = this.u;
    this.bloomScale = quality.bloom;
    const scenePass = pass(scene, camera, { samples: quality.msaaSamples });
    if (quality.ao) {
      // Depth/normal pre-pass → half-res GTAO, fed back into the scene's ambient/indirect light.
      const pre = pass(scene, camera);
      pre.setMRT(mrt({ output: normalView }));
      const depth = pre.getTextureNode('depth');
      const normal = pre.getTextureNode();
      const aoNode = ao(depth, normal, camera);
      aoNode.resolutionScale = 0.5;
      aoNode.radius.value = 0.6;
      aoNode.distanceExponent.value = 1.4;
      // Spatial denoise: GTAO without TRAA is noisy on thin geometry (awnings, rails).
      const aoClean = denoise(aoNode.getTextureNode(), depth, normal, camera);
      scenePass.contextNode = builtinAOContext(convertToTexture(aoClean).sample(screenUV).r);
    }
    const sceneColor = scenePass.getTextureNode('output');

    // Clamp HDR before bloom so the sun disc doesn't flood the frame.
    this.bloomNode = bloom(sceneColor.min(vec4(4, 4, 4, 1)), 0.2, 0.35, 1.0);
    let col = sceneColor.rgb.add(this.bloomNode.rgb).mul(u.tint);

    // Split-tone: teal shadows / warm highlights, keyed off HDR luminance.
    const lumaW = vec3(0.2126, 0.7152, 0.0722);
    const luma = dot(col, lumaW);
    const t = smoothstep(0.02, 0.75, luma.div(luma.add(1)));
    col = col.mul(mix(u.shadowTint, u.highlightTint, t));

    const luma2 = dot(col, lumaW);
    col = mix(vec3(luma2), col, u.saturation);
    // Contrast pivoting on 18% grey.
    col = pow(col.div(0.18).max(0), vec3(u.contrast)).mul(0.18);

    const d = length(uv().sub(0.5).mul(vec2(1.25, 1)));
    col = col.mul(mix(float(1).sub(u.vignette), float(1), smoothstep(0.85, 0.3, d)));

    const toned = renderOutput(vec4(col, 1));
    let rgb = toned.rgb;
    if (quality.filmGrain) {
      const seed = uv()
        .mul(vec2(1920, 1080))
        .add(fract(time.mul(13.7)).mul(100));
      const n = fract(sin(dot(seed, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
      rgb = rgb.add(n.mul(u.grain));
    }
    const graded = vec4(rgb, 1);
    const out = quality.fxaa ? fxaa(graded) : graded;

    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = out;
    this.pipeline.needsUpdate = true;
  }

  setGrade(g: GradeKey): void {
    this.u.tint.value.set(...g.tint);
    this.u.shadowTint.value.set(...g.shadowTint);
    this.u.highlightTint.value.set(...g.highlightTint);
    this.u.saturation.value = g.saturation;
    this.u.contrast.value = g.contrast;
    if (this.bloomNode) this.bloomNode.strength.value = g.bloom * this.bloomScale;
  }

  render(): void {
    this.pipeline.render();
  }
}
