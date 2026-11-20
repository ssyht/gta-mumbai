import * as THREE from 'three/webgpu';

/**
 * Weather (CLAUDE.md §4A.2, §4.10): clear, humid haze, overcast and monsoon
 * downpour. Rain streaks follow the camera; roads and ground darken and turn
 * glossy as they get wet and take time to dry; the sky system reads
 * `cloud`/`rain` to grade, fog and dim the sun. Monsoon months (Jun–Sep) rain
 * far more often.
 */
export type WeatherKind = 'clear' | 'haze' | 'overcast' | 'monsoon';

const TARGETS: Record<WeatherKind, { cloud: number; rain: number; haze: number }> = {
  clear: { cloud: 0.2, rain: 0, haze: 0 },
  haze: { cloud: 0.35, rain: 0, haze: 1 },
  overcast: { cloud: 0.85, rain: 0, haze: 0.5 },
  monsoon: { cloud: 1, rain: 1, haze: 0.8 },
};

const DROPS = 5000;
const BOX = 40;

export class Weather {
  kind: WeatherKind = 'clear';
  cloud = 0.2;
  rain = 0;
  haze = 0;
  /** Surface wetness 0..1: lags the rain (roads take time to dry). */
  wetness = 0;
  private timer = 240;
  private readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly wetMats: Array<{ m: THREE.MeshStandardMaterial; rough: number; color: THREE.Color }> = [];
  private appliedWet = -1;
  /** Called with 0..1 rain loudness (audio). */
  onRain: ((amount: number) => void) | null = null;
  onThunder: (() => void) | null = null;
  private thunderTimer = 20;
  flash = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.pos = new Float32Array(DROPS * 6);
    for (let i = 0; i < DROPS; i++) this.resetDrop(i, new THREE.Vector3(), true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0xbfd0e0, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    const month = new Date().getMonth() + 1;
    if (month >= 6 && month <= 9 && Math.random() < 0.5) this.set('monsoon', true);
    else if (Math.random() < 0.3) this.set('haze', true);
  }

  /** Collect rough, opaque standard materials (roads, ground, walls) once the world is built. */
  collectWetSurfaces(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.receiveShadow) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (!m || Array.isArray(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      if (m.roughness < 0.8 || m.transparent || this.wetMats.some((w) => w.m === m)) return;
      this.wetMats.push({ m, rough: m.roughness, color: m.color.clone() });
    });
  }

  set(kind: WeatherKind, instant = false): void {
    this.kind = kind;
    this.timer = 240 + Math.random() * 360;
    if (instant) {
      const t = TARGETS[kind];
      this.cloud = t.cloud;
      this.rain = t.rain;
      this.haze = t.haze;
      this.wetness = t.rain;
    }
  }

  cycle(): WeatherKind {
    const order: WeatherKind[] = ['clear', 'haze', 'overcast', 'monsoon'];
    this.set(order[(order.indexOf(this.kind) + 1) % order.length]!);
    return this.kind;
  }

  private resetDrop(i: number, c: THREE.Vector3, randomY: boolean): void {
    const x = c.x + (Math.random() - 0.5) * BOX * 2;
    const z = c.z + (Math.random() - 0.5) * BOX * 2;
    const y = c.y + (randomY ? Math.random() * 30 - 5 : 25);
    this.pos.set([x, y, z, x + 0.05, y - 0.9, z + 0.02], i * 6);
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      const month = new Date().getMonth() + 1;
      const monsoon = month >= 6 && month <= 9;
      const r = Math.random();
      this.set(r < (monsoon ? 0.45 : 0.08) ? 'monsoon' : r < 0.6 ? 'clear' : r < 0.8 ? 'haze' : 'overcast');
    }
    const t = TARGETS[this.kind];
    const k = 1 - Math.exp(-dt / 12);
    this.cloud += (t.cloud - this.cloud) * k;
    this.rain += (t.rain - this.rain) * (1 - Math.exp(-dt / 6));
    this.haze += (t.haze - this.haze) * k;
    // Wet fast, dry slowly.
    this.wetness += this.rain > this.wetness ? (this.rain - this.wetness) * dt * 0.25 : -dt * 0.004;
    this.wetness = Math.max(0, Math.min(1, this.wetness));

    this.lines.visible = this.rain > 0.02;
    if (this.lines.visible) {
      const fall = (18 + 6 * this.rain) * dt;
      const active = Math.floor(DROPS * this.rain);
      for (let i = 0; i < DROPS; i++) {
        const o = i * 6;
        if (i >= active) {
          this.pos[o + 1] = this.pos[o + 4] = -999;
          continue;
        }
        this.pos[o + 1]! -= fall;
        this.pos[o + 4]! -= fall;
        if (
          this.pos[o + 1]! < camPos.y - 6 ||
          Math.abs(this.pos[o]! - camPos.x) > BOX ||
          Math.abs(this.pos[o + 2]! - camPos.z) > BOX
        ) {
          this.resetDrop(i, camPos, this.pos[o + 1]! < -900);
        }
      }
      (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.lines.material as THREE.LineBasicMaterial).opacity = 0.2 + 0.25 * this.rain;
    }
    if (Math.abs(this.wetness - this.appliedWet) > 0.02) {
      this.appliedWet = this.wetness;
      for (const w of this.wetMats) {
        w.m.roughness = w.rough * (1 - 0.65 * this.wetness);
        w.m.color.copy(w.color).multiplyScalar(1 - 0.32 * this.wetness);
      }
    }
    this.onRain?.(this.rain);
    // Lightning + thunder in heavy rain.
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.rain > 0.7) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = 15 + Math.random() * 35;
        this.flash = 1;
        setTimeout(() => this.onThunder?.(), 600 + Math.random() * 1800);
      }
    }
  }
}
