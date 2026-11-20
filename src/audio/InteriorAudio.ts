import type * as THREE from 'three/webgpu';

/**
 * Interior sound (SCENARIOS.md A1 + A5): stepping through a doorway runs the
 * street mix through a low-pass (18 kHz → 1.2 kHz, −9 dB) while the room bed
 * fades in (ceiling-fan hum, fridge compressor, a transistor radio playing an
 * original old-film-style tune). Voices use a procedural murmur whose pitch,
 * pace and tremble come from emotion, routed past the street filter.
 */
export interface VoiceOpts {
  pitch?: number;
  rate?: number;
  tremble?: number;
  volume?: number;
}

const VOWELS: Array<[number, number]> = [
  [800, 1200],
  [400, 2000],
  [300, 2300],
  [500, 900],
  [350, 800],
  [600, 1700],
];
// Old film tune in a major (Bilawal-like) mode, 8-beat keherwa feel.
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14];
const TUNE = [
  4, 5, 7, 7, 5, 4, 2, 4, 5, 4, 2, 0, 2, 4, 2, -1, 0, 2, 4, 5, 7, 8, 7, 5, 4, 5, 4, 2, 0, 0, -1, -1,
];

export class InteriorAudio {
  private readonly ctx: AudioContext;
  /** Bypasses the listener's street filter. */
  private readonly bus: GainNode;
  private readonly streetFilter: BiquadFilterNode;
  private readonly bed: GainNode;
  private readonly radioGain: GainNode;
  private noise: AudioBuffer;
  private started = false;
  private nextNote = 0;
  private step = 0;
  private master = 1;

  constructor(private readonly listener: THREE.AudioListener) {
    this.ctx = listener.context;
    this.bus = this.ctx.createGain();
    this.bus.connect(this.ctx.destination);
    this.streetFilter = this.ctx.createBiquadFilter();
    this.streetFilter.type = 'lowpass';
    this.streetFilter.frequency.value = 18000;
    this.streetFilter.Q.value = 0.5;
    listener.setFilter(this.streetFilter);
    this.bed = this.ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(this.bus);
    this.radioGain = this.ctx.createGain();
    this.radioGain.gain.value = 0.5;
    // Transistor-radio band-pass + light crackle.
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 0.6;
    this.radioGain.connect(bp).connect(this.bed);
    this.noise = this.makeNoise();
  }

  private makeNoise(): AudioBuffer {
    const len = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;
    // Ceiling fan: low motor hum with a slow beat, plus air swish.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 180;
    const humG = ctx.createGain();
    humG.gain.value = 0.05;
    hum.connect(humF).connect(humG).connect(this.bed);
    hum.start();
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const airF = ctx.createBiquadFilter();
    airF.type = 'bandpass';
    airF.frequency.value = 600;
    airF.Q.value = 0.4;
    const airG = ctx.createGain();
    airG.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2.6;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.015;
    lfo.connect(lfoG).connect(airG.gain);
    lfo.start();
    air.connect(airF).connect(airG).connect(this.bed);
    air.start();
    // Fridge compressor drone.
    const comp = ctx.createOscillator();
    comp.type = 'triangle';
    comp.frequency.value = 98;
    const compG = ctx.createGain();
    compG.gain.value = 0.012;
    comp.connect(compG).connect(this.bed);
    comp.start();
    // Radio crackle.
    const cr = ctx.createBufferSource();
    cr.buffer = this.noise;
    cr.loop = true;
    const crG = ctx.createGain();
    crG.gain.value = 0.012;
    cr.connect(crG).connect(this.radioGain);
    cr.start();
    // Harmonium drone (Sa + Pa).
    for (const f of [261.6, 392]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f / 2;
      const g = ctx.createGain();
      g.gain.value = 0.025;
      o.connect(g).connect(this.radioGain);
      o.start();
    }
    this.nextNote = ctx.currentTime + 0.2;
  }

  /**
   * @param indoor 0..1 threshold blend; @param near 0..1 how close the room is (for the faint bed from the street)
   */
  update(indoor: number, near: number, masterVolume: number): void {
    this.master = masterVolume;
    this.bus.gain.value = masterVolume;
    if (near <= 0 && indoor <= 0) {
      this.bed.gain.value = 0;
      this.streetFilter.frequency.value = 18000;
      return;
    }
    this.start();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // Exponential sweep in frequency feels linear to the ear.
    const f = 18000 * Math.pow(1200 / 18000, indoor);
    this.streetFilter.frequency.setTargetAtTime(f, t, 0.05);
    this.listener.gain.gain.setTargetAtTime(masterVolume * Math.pow(10, (-9 * indoor) / 20), t, 0.05);
    this.bed.gain.setTargetAtTime(0.9 * Math.max(indoor, near * 0.25), t, 0.08);
    // Radio tune scheduler (a few notes ahead).
    while (this.nextNote < t + 0.3) {
      const beat = 0.32;
      const deg = TUNE[this.step % TUNE.length]!;
      const semis = deg < 0 ? SCALE[0]! - 1 : SCALE[Math.min(SCALE.length - 1, deg)]!;
      const freq = 523.25 * Math.pow(2, semis / 12);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vg = ctx.createGain();
      vg.gain.value = freq * 0.012;
      vib.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      const n = this.nextNote;
      g.gain.setValueAtTime(0, n);
      g.gain.linearRampToValueAtTime(0.09, n + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, n + beat * 1.6);
      o.connect(g).connect(this.radioGain);
      o.start(n);
      vib.start(n);
      o.stop(n + beat * 1.7);
      vib.stop(n + beat * 1.7);
      // Dholak: bass on 1 and 5, slaps between.
      const pos = this.step % 8;
      if (pos === 0 || pos === 5 || pos === 3 || pos === 6) this.drum(n, pos === 0 || pos === 5);
      this.nextNote += beat;
      this.step++;
    }
  }

  private drum(t: number, bass: boolean): void {
    const ctx = this.ctx;
    if (bass) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(this.radioGain);
      o.start(t);
      o.stop(t + 0.3);
    } else {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      s.connect(f).connect(g).connect(this.radioGain);
      s.start(t, Math.random() * 0.5, 0.1);
    }
  }

  /** Procedural murmur voice for a line. Returns its duration in seconds. */
  voice(text: string, distance: number, o: VoiceOpts = {}): number {
    const ctx = this.ctx;
    const syll = text.replace(/[^a-zA-Zऀ-ॿ ,.?!…]/g, '').match(/[^aeiou\s,.?!…]*[aeiou]+|[,.?!…]/gi) ?? [];
    const rate = o.rate ?? 1;
    const base = 120 * (o.pitch ?? 1);
    const vol = (o.volume ?? 0.6) / (1 + distance / 3);
    let t = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = vol * this.master;
    out.connect(this.bus);
    syll.forEach((s, i) => {
      if (/[,.?!…]/.test(s)) {
        t += 0.18 / rate;
        return;
      }
      const dur = (0.09 + Math.random() * 0.06) / rate;
      const src = ctx.createOscillator();
      src.type = 'sawtooth';
      const contour = 1 + 0.12 * Math.sin(i * 0.9) - (i / Math.max(1, syll.length)) * 0.1;
      src.frequency.setValueAtTime(base * contour, t);
      src.frequency.linearRampToValueAtTime(base * contour * (0.94 + Math.random() * 0.1), t + dur);
      if (o.tremble) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 9;
        const lg = ctx.createGain();
        lg.gain.value = base * 0.04 * o.tremble;
        lfo.connect(lg).connect(src.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.02);
      }
      const [f1, f2] = VOWELS[Math.floor(Math.random() * VOWELS.length)]!;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.015);
      g.gain.setValueAtTime(1, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, t + dur);
      for (const [f, q, a] of [
        [f1, 8, 0.5],
        [f2, 10, 0.3],
      ] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const ga = ctx.createGain();
        ga.gain.value = a;
        src.connect(bp).connect(ga).connect(g);
      }
      g.connect(out);
      src.start(t);
      src.stop(t + dur + 0.02);
      t += dur + 0.012 / rate;
    });
    return t - ctx.currentTime;
  }

  /** Short metallic hit: coins on glass, drawer rattle, shutter. */
  clink(kind: 'coin' | 'drawer' | 'shutter' | 'thump' | 'bell', distance = 1): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = this.master / (1 + distance / 4);
    out.connect(this.bus);
    if (kind === 'coin' || kind === 'bell') {
      for (const f of kind === 'coin'
        ? [3200 + Math.random() * 900, 5100 + Math.random() * 700]
        : [1760, 2637]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(kind === 'coin' ? 0.12 : 0.1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'coin' ? 0.25 : 0.9));
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 1);
      }
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'thump' ? 'lowpass' : 'bandpass';
    f.frequency.value = kind === 'thump' ? 300 : kind === 'drawer' ? 1800 : 900;
    f.Q.value = kind === 'shutter' ? 2 : 1;
    const g = ctx.createGain();
    const len = kind === 'shutter' ? 1.5 : kind === 'drawer' ? 0.35 : 0.08;
    g.gain.setValueAtTime(kind === 'thump' ? 0.5 : 0.18, t);
    if (kind === 'shutter' || kind === 'drawer') {
      // Rattle: amplitude-modulated noise.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = kind === 'shutter' ? 22 : 30;
      const lg = ctx.createGain();
      lg.gain.value = 0.12;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + len);
    }
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    s.connect(f).connect(g).connect(out);
    s.start(t, 0, len + 0.05);
  }
}
