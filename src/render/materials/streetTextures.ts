import * as THREE from 'three/webgpu';
import { mulberry32 } from './textures';

/**
 * Procedural texture kit for dense Mumbai streets (all original art, drawn on
 * canvas at load): facade window atlas + night mask, rolling shutters,
 * Mangalore roof tiles, palm fronds and leaf clusters (alpha), a shop-sign
 * atlas, painted film hoardings and wall murals.
 */
const SIGN_FONT = 'Mukta, "Noto Sans Devanagari", sans-serif';
const DISPLAY = '"Bebas Neue", Mukta, Impact, sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function grime(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: () => number,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const v = 40 + rnd() * 60;
    ctx.fillStyle = `rgba(${v},${v - 5},${v - 12},${0.04 + rnd() * 0.1})`;
    const s = 1 + rnd() * 3;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, s, s);
  }
  // Monsoon streaks running down from sills.
  for (let i = 0; i < n / 300; i++) {
    const sx = x + rnd() * w;
    const sy = y + rnd() * h * 0.6;
    const g = ctx.createLinearGradient(0, sy, 0, sy + h * 0.5);
    g.addColorStop(0, `rgba(50,48,40,${0.12 + rnd() * 0.18})`);
    g.addColorStop(1, 'rgba(50,48,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, sy, 2 + rnd() * 9, h * 0.5);
  }
}

/**
 * 2×2 facade atlas, each cell = one bay × one floor:
 *  (0,0) grilled window · (1,0) colonial arched window with louvred shutters
 *  (0,1) balcony door    · (1,1) small window + vent
 * `mask` red channel = glass (lit at night).
 */
export function facadeAtlas(): { map: THREE.CanvasTexture; mask: THREE.CanvasTexture } {
  const S = 512;
  const [c, ctx] = canvas(S * 2, S * 2);
  const [m, mctx] = canvas(S * 2, S * 2);
  const rnd = mulberry32(77);
  ctx.fillStyle = '#ece7dc';
  ctx.fillRect(0, 0, S * 2, S * 2);
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, S * 2, S * 2);

  const glass = (x: number, y: number, w: number, h: number, arch = false): void => {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#2c3a44');
    g.addColorStop(0.45, '#46606e');
    g.addColorStop(1, '#1b252c');
    ctx.fillStyle = g;
    mctx.fillStyle = '#fff';
    if (arch) {
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y + w / 2);
      ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      mctx.beginPath();
      mctx.moveTo(x + 4, y + h - 4);
      mctx.lineTo(x + 4, y + w / 2);
      mctx.arc(x + w / 2, y + w / 2, w / 2 - 4, Math.PI, 0);
      mctx.lineTo(x + w - 4, y + h - 4);
      mctx.closePath();
      mctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
      mctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    }
    // Curtains / clutter silhouettes inside.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(${120 + rnd() * 120},${60 + rnd() * 100},${60 + rnd() * 90},0.35)`;
      ctx.fillRect(x + rnd() * w * 0.7, y + h * 0.2, w * 0.25, h * 0.75);
    }
  };
  const frame = (x: number, y: number, w: number, h: number, color = '#4a3f35', lw = 10): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  };
  const grille = (x: number, y: number, w: number, h: number): void => {
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 4;
    for (let i = 1; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (w * i) / 7, y);
      ctx.lineTo(x + (w * i) / 7, y + h);
      ctx.stroke();
    }
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(x, y + h * f);
      ctx.lineTo(x + w, y + h * f);
      ctx.stroke();
    }
  };
  const sill = (x: number, y: number, w: number): void => {
    ctx.fillStyle = '#cfc8ba';
    ctx.fillRect(x - 14, y, w + 28, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 10, y + 14, w + 20, 10);
  };

  // (0,0) grilled window
  {
    const x = 120;
    const y = 120;
    glass(x, y, 272, 230);
    grille(x, y, 272, 230);
    frame(x, y, 272, 230);
    sill(x, y + 230, 272);
  }
  // (1,0) colonial arched window with green louvred shutters
  {
    const ox = S;
    const x = ox + 170;
    const y = 90;
    glass(x, y, 172, 300, true);
    ctx.strokeStyle = '#3c3a33';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + 86, y + 20);
    ctx.lineTo(x + 86, y + 300);
    ctx.stroke();
    for (const sx of [x - 80, x + 172 + 8]) {
      ctx.fillStyle = '#2f6b5a';
      ctx.fillRect(sx, y + 60, 72, 240);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 3;
      for (let k = y + 70; k < y + 300; k += 12) {
        ctx.beginPath();
        ctx.moveTo(sx + 6, k);
        ctx.lineTo(sx + 66, k);
        ctx.stroke();
      }
    }
    // Keystone + moulding.
    ctx.strokeStyle = '#d9d2c4';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(x + 86, y + 86, 100, Math.PI, 0);
    ctx.stroke();
    sill(x, y + 300, 172);
  }
  // (0,1) balcony door
  {
    const oy = S;
    const x = 150;
    const y = oy + 60;
    glass(x, y, 212, 452);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(x, y, 100, 452);
    ctx.fillRect(x + 112, y, 100, 452);
    ctx.fillStyle = 'rgba(30,40,45,0.9)';
    ctx.fillRect(x + 14, y + 20, 72, 180);
    ctx.fillRect(x + 126, y + 20, 72, 180);
    frame(x, y, 212, 452, '#3b2a1c', 12);
  }
  // (1,1) small window + exhaust vent
  {
    const ox = S;
    const oy = S;
    glass(ox + 90, oy + 150, 170, 170);
    grille(ox + 90, oy + 150, 170, 170);
    frame(ox + 90, oy + 150, 170, 170);
    sill(ox + 90, oy + 320, 170);
    ctx.fillStyle = '#5c5750';
    ctx.fillRect(ox + 340, oy + 170, 90, 90);
    ctx.strokeStyle = '#2a2724';
    ctx.lineWidth = 5;
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(ox + 345, oy + 180 + k * 14);
      ctx.lineTo(ox + 425, oy + 180 + k * 14);
      ctx.stroke();
    }
  }
  // Floor slab band at the bottom of every cell.
  for (let cy = 0; cy < 2; cy++) {
    ctx.fillStyle = 'rgba(110,100,88,0.45)';
    ctx.fillRect(0, cy * S + S - 16, S * 2, 16);
  }
  grime(ctx, 0, 0, S * 2, S * 2, rnd, 30000);
  return { map: tex(c), mask: tex(m, false) };
}

export function shutterTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(4);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    const g = ctx.createLinearGradient(0, y, 0, y + 8);
    g.addColorStop(0, '#f4f4f4');
    g.addColorStop(0.6, '#bdbdbd');
    g.addColorStop(1, '#8a8a8a');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, 256, 8);
  }
  grime(ctx, 0, 0, 256, 256, rnd, 3000);
  return tex(c);
}

export function roofTileTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(6);
  ctx.fillStyle = '#7a3b24';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) {
    for (let x = 0; x < 256; x += 22) {
      const v = 0.75 + rnd() * 0.35;
      ctx.fillStyle = `rgb(${Math.floor(160 * v)},${Math.floor(78 * v)},${Math.floor(48 * v)})`;
      ctx.beginPath();
      ctx.ellipse(x + 11 + ((y / 16) % 2) * 11, y + 10, 11, 9, 0, 0, Math.PI);
      ctx.fill();
    }
  }
  grime(ctx, 0, 0, 256, 256, rnd, 4000);
  return tex(c);
}

/** Alpha palm frond: central rib with drooping leaflets. */
export function frondTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 512);
  ctx.clearRect(0, 0, 128, 512);
  ctx.strokeStyle = '#4b5a2a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 512);
  ctx.stroke();
  for (let y = 10; y < 500; y += 7) {
    const t = y / 512;
    const len = 56 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05));
    for (const side of [-1, 1]) {
      const g = 90 + Math.random() * 40;
      ctx.strokeStyle = `rgb(${40 + Math.random() * 30},${g},${30 + Math.random() * 20})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, y);
      ctx.quadraticCurveTo(64 + side * len * 0.6, y + 6, 64 + side * len, y + 22);
      ctx.stroke();
    }
  }
  return tex(c, true, false);
}

/** Alpha leaf cluster for broadleaf trees (gulmohar / peepal-ish). */
export function leafClusterTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(9);
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 110;
    const x = 128 + Math.cos(a) * r;
    const y = 128 + Math.sin(a) * r * 0.85;
    const g = 70 + rnd() * 80;
    ctx.fillStyle = `rgb(${25 + rnd() * 40},${g},${20 + rnd() * 30})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 7 + rnd() * 6, 4 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, true, false);
}

export interface SignSpec {
  text: string;
  dev?: string;
  bg: string;
  fg?: string;
  accent?: string;
}

/** Many shop boards packed into one atlas → one draw call for every sign. */
export class SignAtlas {
  readonly cols = 4;
  readonly rows = 16;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private next = 0;
  private readonly cw = 512;
  private readonly ch = 128;

  constructor() {
    const [c, ctx] = canvas(this.cw * this.cols, this.ch * this.rows);
    this.ctx = ctx;
    this.texture = tex(c, true, false);
  }

  /** Draw a sign; returns its UV rect [u0, v0, u1, v1] (v up). */
  add(s: SignSpec, seed = 1): [number, number, number, number] {
    const i = this.next++ % (this.cols * this.rows);
    const cx = (i % this.cols) * this.cw;
    const cy = Math.floor(i / this.cols) * this.ch;
    const ctx = this.ctx;
    const rnd = mulberry32(seed);
    ctx.fillStyle = s.bg;
    ctx.fillRect(cx, cy, this.cw, this.ch);
    ctx.strokeStyle = s.accent ?? 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 6;
    ctx.strokeRect(cx + 6, cy + 6, this.cw - 12, this.ch - 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.fg ?? '#ffffff';
    if (s.dev) {
      ctx.font = `800 46px ${SIGN_FONT}`;
      ctx.fillText(s.dev, cx + this.cw / 2, cy + 44, this.cw - 30);
      ctx.font = `400 40px ${DISPLAY}`;
      ctx.fillStyle = s.accent ?? '#fff59d';
      ctx.fillText(s.text, cx + this.cw / 2, cy + 96, this.cw - 30);
    } else {
      ctx.font = `400 64px ${DISPLAY}`;
      ctx.fillText(s.text, cx + this.cw / 2, cy + 68, this.cw - 30);
    }
    grime(ctx, cx, cy, this.cw, this.ch, rnd, 900);
    this.texture.needsUpdate = true;
    const W = this.cw * this.cols;
    const H = this.ch * this.rows;
    return [cx / W, 1 - (cy + this.ch) / H, (cx + this.cw) / W, 1 - cy / H];
  }
}

/** Hand-painted film hoarding: gradient sky, silhouetted cast, Devanagari + English title. */
export function posterTexture(
  title: string,
  dev: string,
  palette: [string, string, string],
  seed: number,
): THREE.CanvasTexture {
  const W = 1024;
  const H = 400;
  const [c, ctx] = canvas(W, H);
  const rnd = mulberry32(seed);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, palette[0]);
  g.addColorStop(0.55, palette[1]);
  g.addColorStop(1, palette[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Sunburst.
  ctx.save();
  ctx.translate(W * 0.3, H * 0.55);
  for (let i = 0; i < 24; i++) {
    ctx.rotate((Math.PI * 2) / 24);
    ctx.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.05})`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(900, -40);
    ctx.lineTo(900, 40);
    ctx.fill();
  }
  ctx.restore();
  // Cast: painted heads and shoulders with rim light.
  const heads = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < heads; i++) {
    const x = 60 + (i / heads) * W * 0.55 + rnd() * 30;
    const s = 0.7 + rnd() * 0.7;
    const y = H - 30 - rnd() * 60;
    const skin = `hsl(${22 + rnd() * 12}, ${40 + rnd() * 20}%, ${32 + rnd() * 20}%)`;
    ctx.fillStyle = `hsl(${rnd() * 360}, 55%, ${25 + rnd() * 20}%)`;
    ctx.beginPath();
    ctx.ellipse(x, y + 40 * s, 95 * s, 70 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(x, y - 60 * s, 42 * s, 54 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#120d0b';
    ctx.beginPath();
    ctx.ellipse(x, y - 92 * s, 46 * s, 28 * s, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,200,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y - 60 * s, 42 * s, 54 * s, 0, -1.2, 0.6);
    ctx.stroke();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 14;
  ctx.font = `800 72px ${SIGN_FONT}`;
  ctx.fillText(dev, W - 40, 120);
  ctx.font = `400 112px ${DISPLAY}`;
  ctx.fillStyle = '#ffe14d';
  ctx.fillText(title, W - 40, 230);
  ctx.font = `400 34px ${DISPLAY}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('IN CINEMAS THIS FRIDAY', W - 40, 290);
  ctx.font = `400 20px ${DISPLAY}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText(
    'WRITTEN & DIRECTED BY A. KAPADIA · MUSIC R. SHANKAR · A MAYANAGRI FILMS RELEASE',
    W - 40,
    360,
  );
  return tex(c, true, false);
}

/** Abstract wall mural (street-art style swirls + bold shapes). */
export function muralTexture(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const rnd = mulberry32(seed);
  const hues = [rnd() * 360, rnd() * 360, rnd() * 360];
  ctx.fillStyle = `hsl(${hues[0]}, 60%, 40%)`;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `hsl(${hues[i % 3]! + rnd() * 30}, 80%, ${45 + rnd() * 25}%)`;
    ctx.lineWidth = 8 + rnd() * 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rnd() * W, rnd() * H);
    ctx.bezierCurveTo(rnd() * W, rnd() * H, rnd() * W, rnd() * H, rnd() * W, rnd() * H);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `hsla(${rnd() * 360}, 85%, 60%, 0.85)`;
    ctx.beginPath();
    ctx.arc(rnd() * W, rnd() * H, 8 + rnd() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  grime(ctx, 0, 0, W, H, rnd, 4000);
  return tex(c, true, false);
}

/** Shop interior: shelves crammed with colourful goods (back wall of every shop). */
export function shopInteriorTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(31);
  ctx.fillStyle = '#2a211b';
  ctx.fillRect(0, 0, 256, 256);
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 20 + shelf * 46;
    ctx.fillStyle = '#5b4632';
    ctx.fillRect(0, y + 36, 256, 6);
    let x = 4;
    while (x < 250) {
      const w = 6 + rnd() * 18;
      const h = 14 + rnd() * 22;
      ctx.fillStyle = `hsl(${rnd() * 360}, ${25 + rnd() * 35}%, ${22 + rnd() * 30}%)`;
      ctx.fillRect(x, y + 36 - h, w, h);
      x += w + 1 + rnd() * 3;
    }
  }
  return tex(c);
}
