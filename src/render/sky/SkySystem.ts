import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  normalWorld,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import type { QualityConfig } from '../../core/Settings';
import { lightUniforms } from '../lightUniforms';
import type { PostFX } from '../PostFX';
import type { TimeOfDay } from './TimeOfDay';
import {
  dayPhase,
  gradeFor,
  moonIntensity,
  nightFactor,
  streetLightFactor,
  sunColor,
  sunIntensity,
  windowLightFactor,
  type DayPhase,
  type GradeKey,
} from './lightingCurves';

const RAD2DEG = 180 / Math.PI;
const SKY_RADIUS = 3600;
const MOONLIGHT = new THREE.Color(0.62, 0.72, 1.0);

/**
 * Sky, sun/moon key light with cascaded shadows, ambient, fog, stars, moon,
 * horizon haze and night light-pollution glow, all driven by TimeOfDay.
 * M2.5 swaps SkyMesh for @takram/three-atmosphere (CLAUDE.md §4A.2).
 */
export class SkySystem {
  readonly sky: SkyMesh;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fog: THREE.FogExp2;
  /** Half-size (m) of the shadow frustum that follows the camera. */
  private readonly shadowHalf: number;
  grade: GradeKey;
  phase: DayPhase = 'day';
  /** Exposure bias from the dev panel (multiplies the grade exposure). */
  exposureBias = 1;
  fogBias = 1;

  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  private readonly haze: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly uFog = uniform(new THREE.Color(0.8, 0.8, 0.8));
  private readonly uSunTint = uniform(new THREE.Color(1, 0.6, 0.3));
  private readonly uMoonBright = uniform(1);
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly renderer: THREE.WebGPURenderer,
    quality: QualityConfig,
  ) {
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(SKY_RADIUS);
    this.sky.frustumCulled = false;
    this.sky.turbidity.value = 7;
    this.sky.rayleigh.value = 1.6;
    this.sky.mieCoefficient.value = 0.006;
    this.sky.mieDirectionalG.value = 0.82;
    this.sky.cloudCoverage.value = 0.32;
    this.sky.cloudDensity.value = 0.35;
    scene.add(this.sky);

    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    const cam = this.key.shadow.camera;
    cam.near = 1;
    cam.far = 600;
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    // r187's CSMShadowNode throws during TSL build (see docs/decisions); until M2.5
    // we use one camera-following ortho shadow with texel snapping (no shimmer).
    this.shadowHalf = quality.shadowFar / 3.2;
    cam.left = -this.shadowHalf;
    cam.right = this.shadowHalf;
    cam.top = this.shadowHalf;
    cam.bottom = -this.shadowHalf;
    scene.add(this.key, this.key.target);

    this.hemi = new THREE.HemisphereLight(0xbcd0ff, 0x6b5a48, 1);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xcccccc, 0.0022);
    scene.fog = this.fog;

    this.stars = this.makeStars();
    this.moon = this.makeMoon();
    this.haze = this.makeHaze();
    this.glow = this.makeGlow();
    scene.add(this.stars, this.moon, this.haze, this.glow);
    this.grade = gradeFor(30, true);
  }

  private makeStars(): THREE.Points {
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Uniform on the upper hemisphere (plus a little below for the sea horizon).
      const y = Math.random() * 1.05 - 0.05;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set(
        [Math.cos(a) * r * (SKY_RADIUS - 200), y * (SKY_RADIUS - 200), Math.sin(a) * r * (SKY_RADIUS - 200)],
        i * 3,
      );
      const b = 0.4 + Math.random() ** 3 * 2.4;
      const warm = Math.random();
      col.set([b * (0.85 + 0.15 * warm), b * 0.9, b * (1.05 - 0.2 * warm)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsNodeMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    mat.opacityNode = lightUniforms.night.mul(0.95);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -5;
    return pts;
  }

  private makeMoon(): THREE.Mesh {
    const mat = new THREE.MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: false });
    // The lit side faces the sun, which gives the real phase for free.
    const lit = smoothstep(-0.08, 0.18, dot(normalWorld, lightUniforms.sunDir));
    mat.colorNode = vec3(1.0, 0.97, 0.9).mul(lit.mul(1.6).add(0.025)).mul(this.uMoonBright);
    mat.opacityNode = mix(float(0.35), float(1), lightUniforms.night);
    const m = new THREE.Mesh(new THREE.SphereGeometry(34, 32, 16), mat);
    m.frustumCulled = false;
    m.renderOrder = -4;
    return m;
  }

  /** Blends the sky into the fog colour at the horizon so distant ground and sky meet without a seam. */
  private makeHaze(): THREE.Mesh {
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const dir = normalize(positionLocal);
    const sunGlow = pow(max(dot(dir, lightUniforms.sunDir), 0), float(48));
    mat.colorNode = mix(this.uFog, this.uSunTint, clamp(sunGlow.mul(1.4), 0, 1));
    mat.opacityNode = float(1)
      .sub(smoothstep(-0.03, 0.09, dir.y))
      .mul(0.9);
    const m = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS - 100, 48, 24), mat);
    m.frustumCulled = false;
    m.renderOrder = -3;
    return m;
  }

  /** Orange sodium light-pollution glow over the city at night. */
  private makeGlow(): THREE.Mesh {
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const dir = normalize(positionLocal);
    const band = pow(float(1).sub(clamp(dir.y.mul(2.6), 0, 1)), float(3));
    mat.colorNode = vec4(vec3(1.0, 0.42, 0.16).mul(band).mul(lightUniforms.night).mul(0.32), 1);
    const m = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS - 150, 48, 24), mat);
    m.frustumCulled = false;
    m.renderOrder = -2;
    return m;
  }

  /** Kept for API stability with the M2.5 CSM version. */
  setCamera(_camera: THREE.PerspectiveCamera): void {}

  update(tod: TimeOfDay, camera: THREE.Camera, post: PostFX): void {
    const sunDir = tod.sunDir;
    const moonDir = tod.moonDir;
    const alt = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * RAD2DEG;
    const moonAlt = Math.asin(THREE.MathUtils.clamp(moonDir.y, -1, 1)) * RAD2DEG;
    const morning = tod.state.isMorning;
    this.phase = dayPhase(alt, morning);
    const g = (this.grade = gradeFor(alt, morning));

    // One key light: the sun by day, the moon by night (moon shadows, no extra light/recompile).
    const useSun = alt > -3 || moonAlt <= 0;
    if (useSun) {
      const [r, gg, b] = sunColor(alt);
      this.key.color.setRGB(r, gg, b);
      this.key.intensity = sunIntensity(alt);
      this.tmp.copy(sunDir);
    } else {
      this.key.color.copy(MOONLIGHT);
      this.key.intensity = moonIntensity(alt, moonAlt, tod.state.moonFraction);
      this.tmp.copy(moonDir);
    }
    if (this.tmp.y < 0.05) this.tmp.y = 0.05; // keep shadow casting from below the ground plane sane
    // Centre the shadow box ahead of the camera, snapped to shadow texels.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    const centre = camera.position.clone().addScaledVector(fwd.normalize(), this.shadowHalf * 0.6);
    centre.y = 0;
    const texel = (this.shadowHalf * 2) / this.key.shadow.mapSize.x;
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.tmp.clone().normalize(),
    );
    const qi = q.clone().invert();
    centre.applyQuaternion(qi);
    centre.x = Math.round(centre.x / texel) * texel;
    centre.y = Math.round(centre.y / texel) * texel;
    centre.applyQuaternion(q);
    this.key.target.position.copy(centre);
    this.key.position.copy(centre).addScaledVector(this.tmp.normalize(), 300);

    this.sky.sunPosition.value.copy(sunDir);
    // Humid haze: thicker scattering when the sun is low.
    const low = 1 - THREE.MathUtils.smoothstep(alt, 0, 25);
    this.sky.turbidity.value = 6 + 4 * low;
    this.sky.rayleigh.value = 1.3 + 1.4 * low;

    this.hemi.color.setRGB(...g.hemiSky);
    this.hemi.groundColor.setRGB(...g.hemiGround);
    this.hemi.intensity = g.hemiIntensity;

    this.fog.color.setRGB(...g.fogColor);
    this.fog.density = g.fogDensity * this.fogBias;
    this.uFog.value.setRGB(...g.fogColor);
    const [sr, sg, sb] = sunColor(Math.max(alt, -2));
    const sunUp = THREE.MathUtils.smoothstep(alt, -4, 1);
    this.uSunTint.value.setRGB(
      sr * 2.2 * sunUp + g.fogColor[0] * (1 - sunUp),
      sg * 1.6 * sunUp + g.fogColor[1] * (1 - sunUp),
      sb * sunUp + g.fogColor[2] * (1 - sunUp),
    );
    this.uMoonBright.value = 0.4 + 0.6 * tod.state.moonFraction;

    this.renderer.toneMappingExposure = g.exposure * this.exposureBias;
    post.setGrade(g);

    lightUniforms.sunDir.value.copy(sunDir);
    lightUniforms.horizon.value.setRGB(...g.fogColor);
    lightUniforms.street.value = streetLightFactor(alt);
    lightUniforms.windows.value = windowLightFactor(alt);
    lightUniforms.night.value = nightFactor(alt);

    // Sky dome objects follow the camera.
    const cp = camera.position;
    this.sky.position.copy(cp);
    this.stars.position.copy(cp);
    this.haze.position.copy(cp);
    this.glow.position.copy(cp);
    this.moon.position
      .copy(moonDir)
      .multiplyScalar(SKY_RADIUS - 400)
      .add(cp);
    this.moon.visible = moonDir.y > -0.05;
  }
}
