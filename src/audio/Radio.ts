/**
 * In-car radio (CLAUDE.md §4.9): three stations of original, procedurally
 * generated music, scheduled with WebAudio, plus short RJ links spoken by the
 * browser's own speech voice (Hindi if the system has one). Everything routes
 * through the game's master output, so volume and mute apply.
 */
export interface Station {
  id: string;
  name: string;
  freq: string;
  bpm: number;
  rj: string[];
}

export const STATIONS: Station[] = [
  {
    id: 'masala',
    name: 'Masala FM',
    freq: '91.1',
    bpm: 96,
    rj: [
      'नमस्ते मुंबई! आप सुन रहे हैं मसाला एफ एम, इक्यानवे पॉइंट एक।',
      'ट्रैफिक में फंसे हो? कोई बात नहीं, गाना सुनो और हॉर्न कम बजाओ!',
      'सी लिंक पर आज हवा बढ़िया है, खिड़की खोलो और मज़े करो।',
    ],
  },
  {
    id: 'lofi',
    name: 'Sea Link Lo-Fi',
    freq: '94.3',
    bpm: 72,
    rj: [
      'Good evening Mumbai, this is Sea Link Lo-Fi. Slow down, the sea isn’t going anywhere.',
      'Chai in one hand, steering in the other? Two hands please.',
    ],
  },
  {
    id: 'bambai',
    name: 'Bambai Beats',
    freq: '98.7',
    bpm: 140,
    rj: [
      'बम्बई बीट्स पर स्वागत है! आवाज़ ऊंची करो!',
      'Bambai Beats. Straight from the gullies to your speakers.',
    ],
  },
];

// Raga-flavoured scale (Bhairav-ish) and minor scales, as semitone offsets.
const BHAIRAV = [0, 1, 4, 5, 7, 8, 11, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12];

export class Radio {
  private ctx: AudioContext;
  private out: GainNode;
  private station = -1;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  private noise: AudioBuffer;
  private rjTimer = 25;
  private bar = 0;
  private melodySeed = 1;
  volume = 1;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.32;
    this.out.connect(destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get current(): Station | null {
    return STATIONS[this.station] ?? null;
  }

  /** Cycle Off → stations → Off. */
  next(): Station | null {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.step = 0;
    this.bar = 0;
    this.melodySeed = Math.floor(Math.random() * 1000);
    if (this.station >= 0) this.start();
    else this.stop();
    return this.current;
  }

  set(id: string | null): void {
    const i = STATIONS.findIndex((s) => s.id === id);
    this.station = i;
    if (i >= 0) this.start();
    else this.stop();
  }

  /** Radio plays only inside vehicles. */
  setAudible(on: boolean): void {
    this.out.gain.setTargetAtTime(on && this.station >= 0 ? 0.32 : 0, this.ctx.currentTime, 0.2);
  }

  private start(): void {
    if (this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    globalThis.speechSynthesis?.cancel();
  }

  update(dt: number, audible: boolean, muted: boolean): void {
    this.setAudible(audible);
    const st = this.current;
    if (!st || !audible || muted) return;
    this.rjTimer -= dt;
    if (this.rjTimer <= 0) {
      this.rjTimer = 40 + Math.random() * 40;
      this.speak(st.rj[Math.floor(Math.random() * st.rj.length)]!);
    }
  }

  private speak(text: string): void {
    const synth = globalThis.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    const hindi = /[ऀ-ॿ]/.test(text);
    const voices = synth.getVoices();
    const v =
      voices.find((x) => x.lang.startsWith(hindi ? 'hi' : 'en-IN')) ??
      voices.find((x) => x.lang.startsWith(hindi ? 'hi' : 'en'));
    if (hindi && !v) return; // no Hindi voice installed: skip rather than mangle it
    if (v) u.voice = v;
    u.lang = hindi ? 'hi-IN' : 'en-IN';
    u.rate = 1.05;
    u.volume = 0.7 * this.volume;
    synth.speak(u);
  }

  private rnd(n: number): number {
    const x = Math.sin(n * 12.9898 + this.melodySeed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  private schedule(): void {
    const st = this.current;
    if (!st) return;
    const sixteenth = 60 / st.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(st, this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  private midi(n: number): number {
    return 440 * 2 ** ((n - 69) / 12);
  }

  private playStep(st: Station, step: number, t: number): void {
    const s = step % 16;
    if (st.id === 'masala') {
      // Dholak-ish: dha on 0/6/8, na on the offbeats, tanpura drone every bar.
      if (s === 0 || s === 6 || s === 10) this.kick(t, 70, 0.5);
      if (s === 4 || s === 12) this.tabla(t, 380, 0.25);
      if (s % 2 === 1) this.tabla(t, 620, 0.08);
      if (s === 0) this.drone(t, 48, (60 / st.bpm) * 4);
      if (s % 2 === 0 && this.rnd(step) > 0.35) {
        const deg = BHAIRAV[Math.floor(this.rnd(step + 7) * BHAIRAV.length)]!;
        this.pluck(t, this.midi(60 + deg + (this.rnd(step + 3) > 0.8 ? 12 : 0)), 0.18);
      }
    } else if (st.id === 'lofi') {
      if (s === 0 || s === 10) this.kick(t, 55, 0.45);
      if (s === 4 || s === 12) this.snare(t, 0.12);
      if (s % 2 === 0) this.hat(t, 0.03);
      if (s === 0) {
        const roots = [57, 53, 50, 55];
        const r = roots[this.bar % roots.length]!;
        for (const iv of [0, 3, 7, 10, 14]) this.keys(t, this.midi(r + iv), (60 / st.bpm) * 4);
      }
      if (this.rnd(step) > 0.97) this.crackle(t);
      if (s % 4 === 2 && this.rnd(step + 11) > 0.5)
        this.keys(t, this.midi(69 + DORIAN[Math.floor(this.rnd(step) * 7)]!), 0.4, 0.05);
    } else {
      // Drill-ish: sliding 808, rolling hats, dark lead.
      if (s === 0 || s === 7 || s === 10) this.sub(t, this.midi(36 + [0, 0, 3, -2][this.bar % 4]!), 0.5);
      if (s === 8) this.snare(t, 0.2);
      if (s % 2 === 0 || (s > 12 && this.rnd(step) > 0.4)) this.hat(t, 0.04);
      if (s % 4 === 0 && this.rnd(step + 5) > 0.3)
        this.lead(t, this.midi(63 + MINOR[Math.floor(this.rnd(step) * 7)]!), 0.22);
    }
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.out);
    return g;
  }

  private kick(t: number, f: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.15);
    o.connect(this.env(t, v, 0.3));
    o.start(t);
    o.stop(t + 0.32);
  }

  private tabla(t: number, f: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.12);
    o.connect(this.env(t, v, 0.18));
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, v: number, decay: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    src.connect(flt).connect(this.env(t, v, decay));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private snare(t: number, v: number): void {
    this.noiseHit(t, 'bandpass', 1800, v, 0.18);
  }

  private hat(t: number, v: number): void {
    this.noiseHit(t, 'highpass', 7000, v, 0.04);
  }

  private crackle(t: number): void {
    this.noiseHit(t, 'highpass', 3000, 0.05, 0.01);
  }

  /** Karplus-Strong-flavoured pluck (sitar-ish with a fast pitch bend). */
  private pluck(t: number, f: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 1.02, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(4000, t);
    flt.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    o.connect(flt).connect(this.env(t, v, 0.6));
    o.start(t);
    o.stop(t + 0.62);
  }

  private drone(t: number, note: number, dur: number): void {
    for (const n of [note, note + 7, note + 12]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = this.midi(n);
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(flt).connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private keys(t: number, f: number, dur: number, v = 0.035): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private sub(t: number, f: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    o.connect(this.env(t, v, 0.5));
    o.start(t);
    o.stop(t + 0.55);
  }

  private lead(t: number, f: number, v: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 1400;
    o.connect(flt).connect(this.env(t, v * 0.3, 0.3));
    o.start(t);
    o.stop(t + 0.32);
  }
}
