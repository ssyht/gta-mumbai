import * as THREE from 'three/webgpu';
import type { GameBus } from '../core/events';
import type { HornId, EngineId } from '../actors/vehicles/VehicleProfile';
import type { Vehicle } from '../actors/vehicles/Vehicle';

/**
 * Procedural WebAudio through three.js PositionalAudio (CLAUDE.md §5): horns,
 * engines, air-brake hiss, a city bed with distant horns, and sea waves.
 * Everything is synthesised for M1; recorded layers (Freesound) come later.
 */
interface HornVoice {
  stop(): void;
}

interface HornSpec {
  freqs: number[];
  type: OscillatorType;
  filter: number;
  melody?: number[];
  /** Pitch wobble (Hz) for cheap, rattly horns. */
  wobble?: number;
}
/** Several horn voices per vehicle class; each vehicle picks one by id so the street sounds varied. */
const HORN_VARIANTS: Record<HornId, HornSpec[]> = {
  car: [
    { freqs: [415, 520], type: 'square', filter: 2400 }, // classic twin-tone
    { freqs: [470, 590], type: 'square', filter: 3000 }, // brighter hatchback
    { freqs: [350, 440], type: 'sawtooth', filter: 1800 }, // deep sedan
    { freqs: [600], type: 'square', filter: 3500, wobble: 6 }, // tinny single beep
  ],
  auto: [
    { freqs: [640, 655], type: 'square', filter: 3200 },
    { freqs: [720], type: 'square', filter: 3800, wobble: 14 }, // buzzy electric horn
    { freqs: [520, 530], type: 'triangle', filter: 2600 }, // bulb-horn "pom"
  ],
  scooter: [
    { freqs: [560, 590], type: 'square', filter: 2800 },
    { freqs: [880], type: 'square', filter: 4200, wobble: 10 }, // thin "meep"
    { freqs: [500], type: 'triangle', filter: 2400 },
  ],
  bus: [
    { freqs: [290, 365, 440], type: 'sawtooth', filter: 1600 }, // air horn chord
    { freqs: [220, 277], type: 'sawtooth', filter: 1200 },
  ],
  // The melodic "Horn OK Please" multi-tone truck horns.
  truck: [
    { freqs: [330], type: 'sawtooth', filter: 1900, melody: [330, 392, 440, 523, 440, 392] },
    { freqs: [294], type: 'sawtooth', filter: 1700, melody: [294, 370, 440, 370] },
    { freqs: [196, 247], type: 'sawtooth', filter: 1100 }, // big pressure horn
  ],
};
function hornFor(id: HornId, key: string): HornSpec {
  const list = HORN_VARIANTS[id];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return list[Math.abs(h) % list.length]!;
}

interface EngineVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  kind: EngineId;
  audio: THREE.PositionalAudio;
}

export class AudioSystem {
  readonly listener = new THREE.AudioListener();
  private readonly ctx: AudioContext;
  private readonly emitters = new Map<string, THREE.PositionalAudio>();
  private readonly horns = new Map<string, HornVoice>();
  private engine: EngineVoice | null = null;
  private noise: AudioBuffer;
  private ambientGain: GainNode | null = null;
  private seaAudio: THREE.PositionalAudio | null = null;
  private distant: THREE.PositionalAudio[] = [];
  private distantTimer = 2;
  private started = false;
  /** 0..1 how busy the city is (rush hour vs 3 AM), from TimeOfDay. */
  density = 0.6;

  constructor(
    camera: THREE.Camera,
    private readonly scene: THREE.Scene,
    bus: GameBus,
    private readonly vehicleById: (id: string) => Vehicle | undefined,
  ) {
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.noise = this.makeNoise();
    bus.on('vehicle:horn', ({ vehicleId, on }) => (on ? this.hornOn(vehicleId) : this.hornOff(vehicleId)));
    bus.on('vehicle:airBrake', ({ vehicleId }) => this.airBrake(vehicleId));
    bus.on('player:enteredVehicle', ({ vehicleId, seatType }) => {
      if (seatType === 'driver') this.startEngine(vehicleId);
    });
    bus.on('player:exitedVehicle', () => this.stopEngine());
    bus.on('weapon:fired', ({ at }) => this.gunshot(at));
  }

  /** Must run from a user gesture (browser autoplay rules). */
  start(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.started) return;
    this.started = true;
    this.startAmbience();
  }

  setVolume(v: number): void {
    this.listener.setMasterVolume(v);
  }

  private makeNoise(): AudioBuffer {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      d[i] = last * 3.5 + white * 0.08;
    }
    return buf;
  }

  private emitter(v: Vehicle): THREE.PositionalAudio {
    let e = this.emitters.get(v.id);
    if (!e) {
      e = new THREE.PositionalAudio(this.listener);
      e.setRefDistance(6);
      e.setRolloffFactor(1.4);
      e.setDistanceModel('inverse');
      v.root.add(e);
      this.emitters.set(v.id, e);
    }
    return e;
  }

  private hornOn(id: string): void {
    const v = this.vehicleById(id);
    if (!v || this.horns.has(id) || !this.started) return;
    const spec = hornFor(v.profile.audio.horn, v.id);
    const out = this.emitter(v).getOutput();
    const t0 = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.32, t0 + 0.015);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.filter;
    filter.connect(gain).connect(out);
    const oscs = spec.freqs.map((f) => {
      const o = this.ctx.createOscillator();
      o.type = spec.type;
      o.frequency.value = f;
      if (spec.wobble) {
        // Rattly cheap horn: fast pitch wobble.
        const lfo = this.ctx.createOscillator();
        const depth = this.ctx.createGain();
        lfo.frequency.value = 28;
        depth.gain.value = spec.wobble;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t0);
        o.addEventListener('ended', () => lfo.stop());
      }
      o.connect(filter);
      o.start(t0);
      return o;
    });
    let melodyTimer: number | undefined;
    if (spec.melody) {
      let step = 0;
      const tick = (): void => {
        const f = spec.melody![step++ % spec.melody!.length]!;
        oscs[0]!.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.01);
      };
      tick();
      melodyTimer = window.setInterval(tick, 150);
    }
    this.horns.set(id, {
      stop: () => {
        if (melodyTimer) clearInterval(melodyTimer);
        const t = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.06);
        for (const o of oscs) o.stop(t + 0.08);
      },
    });
  }

  private hornOff(id: string): void {
    const h = this.horns.get(id);
    if (!h) return;
    h.stop();
    this.horns.delete(id);
  }

  private airBrake(id: string): void {
    const v = this.vehicleById(id);
    if (!v || !this.started) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    src.connect(hp).connect(g).connect(this.emitter(v).getOutput());
    src.start(t);
    src.stop(t + 1);
  }

  private startEngine(id: string): void {
    this.stopEngine();
    const v = this.vehicleById(id);
    if (!v || !this.started) return;
    const kind = v.profile.audio.engine;
    const audio = this.emitter(v);
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = kind === 'auto' || kind === 'scooter' ? 'square' : 'sawtooth';
    sub.type = 'sine';
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'diesel' ? 500 : 900;
    gain.gain.value = 0;
    // Two-stroke put-put (auto) / diesel clatter via amplitude modulation.
    lfo.frequency.value = kind === 'auto' ? 18 : kind === 'diesel' ? 9 : 0.1;
    lfoGain.gain.value = kind === 'auto' || kind === 'diesel' ? 0.5 : 0.05;
    const am = this.ctx.createGain();
    am.gain.value = 0.6;
    lfo.connect(lfoGain).connect(am.gain);
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(am).connect(gain).connect(audio.getOutput());
    osc.start();
    sub.start();
    lfo.start();
    this.engine = { osc, sub, lfo, lfoGain, gain, filter, kind, audio };
  }

  private stopEngine(): void {
    const e = this.engine;
    if (!e) return;
    const t = this.ctx.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.1);
    for (const o of [e.osc, e.sub, e.lfo]) o.stop(t + 0.5);
    this.engine = null;
  }

  private startAmbience(): void {
    // City bed: filtered brown noise.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    src.connect(lp).connect(this.ambientGain).connect(this.listener.getInput());
    src.start();

    // Sea waves at the sea wall, slow swell.
    const sea = new THREE.PositionalAudio(this.listener);
    sea.setRefDistance(25);
    sea.setRolloffFactor(1.2);
    sea.position.set(-42, 0, 0);
    this.scene.add(sea);
    const ws = this.ctx.createBufferSource();
    ws.buffer = this.noise;
    ws.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.4;
    const swell = this.ctx.createGain();
    swell.gain.value = 0.25;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoAmt = this.ctx.createGain();
    lfoAmt.gain.value = 0.2;
    lfo.connect(lfoAmt).connect(swell.gain);
    ws.connect(bp).connect(swell).connect(sea.getOutput());
    ws.start();
    lfo.start();
    this.seaAudio = sea;

    for (let i = 0; i < 4; i++) {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(30);
      a.setRolloffFactor(0.8);
      this.scene.add(a);
      this.distant.push(a);
    }
  }

  /** Mumbai: someone, somewhere, is always honking. */
  private distantHonk(listenerPos: THREE.Vector3): void {
    const a = this.distant[Math.floor(Math.random() * this.distant.length)];
    if (!a) return;
    const ang = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 160;
    a.position.set(listenerPos.x + Math.cos(ang) * r, 2, listenerPos.z + Math.sin(ang) * r);
    const ids = Object.keys(HORN_VARIANTS) as HornId[];
    const spec = hornFor(ids[Math.floor(Math.random() * ids.length)]!, String(Math.random()));
    const t = this.ctx.currentTime;
    const beeps = 1 + Math.floor(Math.random() * 3);
    for (let b = 0; b < beeps; b++) {
      const g = this.ctx.createGain();
      const start = t + b * 0.22;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.01);
      g.gain.setValueAtTime(0.18, start + 0.14);
      g.gain.linearRampToValueAtTime(0, start + 0.18);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = spec.filter * 0.7;
      f.connect(g).connect(a.getOutput());
      for (const freq of spec.freqs) {
        const o = this.ctx.createOscillator();
        o.type = spec.type;
        o.frequency.value = freq;
        o.connect(f);
        o.start(start);
        o.stop(start + 0.2);
      }
    }
  }

  private shotAudio: THREE.PositionalAudio | null = null;
  /** Sharp crack + low thump, positional. */
  gunshot(at: { x: number; y: number; z: number }): void {
    if (!this.started) return;
    if (!this.shotAudio) {
      this.shotAudio = new THREE.PositionalAudio(this.listener);
      this.shotAudio.setRefDistance(12);
      this.scene.add(this.shotAudio);
    }
    this.shotAudio.position.set(at.x, at.y, at.z);
    this.shotAudio.updateMatrixWorld();
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(hp).connect(g).connect(this.shotAudio.getOutput());
    src.start(t);
    src.stop(t + 0.3);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og).connect(this.shotAudio.getOutput());
    o.start(t);
    o.stop(t + 0.2);
  }

  private siren: {
    audio: THREE.PositionalAudio;
    osc: OscillatorNode;
    lfo: OscillatorNode;
    gain: GainNode;
  } | null = null;
  /** Indian two-tone police siren following the nearest police car. */
  updateSiren(at: THREE.Vector3 | null): void {
    if (!this.started) return;
    if (!this.siren && at) {
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setRefDistance(15);
      audio.setRolloffFactor(1.1);
      this.scene.add(audio);
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 700;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1.6;
      const depth = this.ctx.createGain();
      depth.gain.value = 140;
      lfo.connect(depth).connect(osc.frequency);
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 2200;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(flt).connect(gain).connect(audio.getOutput());
      osc.start();
      lfo.start();
      this.siren = { audio, osc, lfo, gain };
    }
    if (!this.siren) return;
    this.siren.gain.gain.setTargetAtTime(at ? 0.12 : 0, this.ctx.currentTime, 0.3);
    if (at) {
      this.siren.audio.position.copy(at);
      this.siren.audio.updateMatrixWorld();
    }
  }

  private rainGain: GainNode | null = null;
  /** Rain loop loudness 0..1 (weather). */
  setRain(amount: number): void {
    if (!this.started) return;
    if (!this.rainGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 7000;
      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(hp).connect(lp).connect(this.rainGain).connect(this.listener.getInput());
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(amount * 0.22, this.ctx.currentTime, 0.5);
  }

  thunder(): void {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    src.connect(lp).connect(g).connect(this.listener.getInput());
    src.start(t);
    src.stop(t + 3.6);
  }

  /** Deep boom for explosions. */
  explosion(at: { x: number; y: number; z: number }): void {
    if (!this.started) return;
    this.gunshot(at);
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(lp).connect(g).connect(this.listener.getInput());
    src.start(t);
    src.stop(t + 2.3);
  }

  get context(): AudioContext {
    return this.ctx;
  }

  update(dt: number, listenerPos: THREE.Vector3, playerVehicle: Vehicle | null): void {
    if (!this.started) return;
    const e = this.engine;
    if (e && playerVehicle) {
      const speed = Math.abs(playerVehicle.physics.speed);
      const top = playerVehicle.profile.engine.topSpeedKmh / 3.6;
      const thr = playerVehicle.physics.controls.throttle;
      // Fake gearbox: rpm saws up through 4 gears.
      // Real engine rpm from the gearbox (GAME_SPEC §12.3: engine synthesis driven by RPM).
      const rpm = 0.18 + 0.82 * playerVehicle.physics.rpmNorm;
      void top;
      void speed;
      const base = e.kind === 'diesel' ? 38 : e.kind === 'auto' ? 52 : e.kind === 'scooter' ? 70 : 60;
      const t = this.ctx.currentTime;
      e.osc.frequency.setTargetAtTime(base + rpm * base * 2.4, t, 0.05);
      e.sub.frequency.setTargetAtTime((base + rpm * base * 2.4) / 2, t, 0.05);
      if (e.kind === 'auto') e.lfo.frequency.setTargetAtTime(14 + rpm * 30, t, 0.05);
      e.gain.gain.setTargetAtTime(0.06 + thr * 0.1 + rpm * 0.04, t, 0.08);
    }
    if (this.ambientGain)
      this.ambientGain.gain.setTargetAtTime(0.025 + 0.05 * this.density, this.ctx.currentTime, 1);
    this.distantTimer -= dt;
    if (this.distantTimer <= 0) {
      this.distantHonk(listenerPos);
      this.distantTimer = (5 + Math.random() * 12) / Math.max(0.2, this.density);
    }
    if (this.seaAudio) this.seaAudio.position.z = listenerPos.z;
  }
}
