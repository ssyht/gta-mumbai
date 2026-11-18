import * as THREE from 'three/webgpu';

/**
 * Procedural canvas textures for the greybox phase (CLAUDE.md §8). No
 * downloads: asphalt, road markings, kerb stripes, pavers, facade cells,
 * hand-painted signage (Devanagari + English) and a water normal map.
 * M2+ replaces these with ambientCG/Poly Haven KTX2 sets.
 */
const SIGN_FONT = 'Mukta, "Noto Sans Devanagari", "Devanagari Sangam MN", sans-serif';
const DISPLAY_FONT = '"Bebas Neue", Mukta, Impact, sans-serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Deterministic PRNG so textures look the same every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  rnd: () => number,
  alpha = 0.18,
): void {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
    const s = 1 + rnd() * 2.5;
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

export function asphaltTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const rnd = mulberry32(7);
  ctx.fillStyle = '#5a5751';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 26000, rnd, 0.25);
  // Patches and repairs: Mumbai roads are a quilt.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(${20 + rnd() * 40},${20 + rnd() * 40},${20 + rnd() * 35},${0.15 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * 512, rnd() * 512, 20 + rnd() * 70, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c);
}

/** One 8 m long tile of a 12 m, four-lane road (u across, v along). */
export function roadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  const rnd = mulberry32(11);
  ctx.fillStyle = '#4a4845';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 22000, rnd, 0.22);
  // Tyre polish in each lane.
  for (const u of [0.13, 0.37, 0.63, 0.87]) {
    const g = ctx.createLinearGradient((u - 0.06) * 512, 0, (u + 0.06) * 512, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(10,10,12,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect((u - 0.06) * 512, 0, 0.12 * 512, 512);
  }
  const worn = (x: number, w: number, y0: number, y1: number, color: string): void => {
    ctx.fillStyle = color;
    for (let y = y0; y < y1; y += 2) if (rnd() > 0.12) ctx.fillRect(x - w / 2, y, w, 2);
  };
  worn(0.03 * 512, 7, 0, 512, 'rgba(235,235,225,0.85)');
  worn(0.97 * 512, 7, 0, 512, 'rgba(235,235,225,0.85)');
  worn(0.49 * 512, 6, 0, 512, 'rgba(240,190,40,0.9)');
  worn(0.51 * 512, 6, 0, 512, 'rgba(240,190,40,0.9)');
  for (const u of [0.25, 0.75]) worn(u * 512, 6, 0, 0.375 * 512, 'rgba(235,235,225,0.8)');
  return finish(c);
}

/** Peeling yellow-black divider/kerb paint. */
export function kerbTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  const rnd = mulberry32(3);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#1c1c1c' : '#e7b416';
    ctx.fillRect(i * 32, 0, 32, 64);
  }
  speckle(ctx, 256, 64, 2500, rnd, 0.35);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(150,145,135,0.8)';
    ctx.fillRect(rnd() * 256, rnd() * 64, 2 + rnd() * 8, 2 + rnd() * 5);
  }
  return finish(c);
}

export function paverTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(5);
  ctx.fillStyle = '#7a756d';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = 105 + rnd() * 35;
      ctx.fillStyle = `rgb(${v + 12},${v},${v - 10})`;
      ctx.fillRect(x * 32 + (y % 2) * 16 + 1, y * 32 + 1, 30, 30);
    }
  }
  speckle(ctx, 256, 256, 5000, rnd, 0.25);
  return finish(c);
}

export function concreteTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rnd = mulberry32(9);
  ctx.fillStyle = '#9a958c';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 9000, rnd, 0.2);
  for (let i = 0; i < 10; i++) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(40,40,35,0)');
    g.addColorStop(1, 'rgba(40,40,35,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(rnd() * 256, 0, 4 + rnd() * 20, 256);
  }
  return finish(c);
}

/**
 * One facade cell = one bay × one floor (≈3.4 m × 3.1 m): plaster, a window
 * with frame and a chajja (sunshade), damp stains. `mask` red = window glass,
 * used by the emissive night-window shader.
 */
export function facadeTextures(): { map: THREE.CanvasTexture; mask: THREE.CanvasTexture } {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const [m, mctx] = canvas(S, S);
  const rnd = mulberry32(21);
  ctx.fillStyle = '#e9e4da';
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 6000, rnd, 0.12);
  // Monsoon damp streaks.
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S;
    const g = ctx.createLinearGradient(0, S * 0.6, 0, S);
    g.addColorStop(0, 'rgba(60,60,50,0)');
    g.addColorStop(1, `rgba(55,55,45,${0.15 + rnd() * 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, S * 0.6, 3 + rnd() * 14, S * 0.4);
  }
  const wx = S * 0.24;
  const wy = S * 0.22;
  const ww = S * 0.52;
  const wh = S * 0.5;
  // Frame + grille.
  ctx.fillStyle = '#5b5248';
  ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  ctx.fillStyle = '#1d2a33';
  ctx.fillRect(wx, wy, ww, wh);
  const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  g.addColorStop(0, 'rgba(160,190,210,0.35)');
  g.addColorStop(0.5, 'rgba(40,60,70,0.1)');
  g.addColorStop(1, 'rgba(150,170,190,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = '#3a342e';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(wx + (ww * i) / 4, wy);
    ctx.lineTo(wx + (ww * i) / 4, wy + wh);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(wx, wy + wh * 0.45);
  ctx.lineTo(wx + ww, wy + wh * 0.45);
  ctx.stroke();
  // Chajja sunshade with its shadow.
  ctx.fillStyle = '#c9c2b5';
  ctx.fillRect(wx - 16, wy - 22, ww + 32, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(wx - 10, wy - 10, ww + 20, 8);
  // Floor slab band.
  ctx.fillStyle = 'rgba(120,112,100,0.5)';
  ctx.fillRect(0, S - 10, S, 10);

  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, S, S);
  mctx.fillStyle = '#fff';
  mctx.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
  return { map: finish(c), mask: finish(m, true, false) };
}

export interface SignLine {
  text: string;
  size: number;
  color: string;
  font?: 'sign' | 'display';
  weight?: number;
}

/** Hand-painted shop board / hoarding / route board. */
export function signTexture(
  lines: SignLine[],
  bg: string,
  w = 512,
  h = 256,
  opts: { border?: string; grime?: boolean; seed?: number } = {},
): THREE.CanvasTexture {
  const [c, ctx] = canvas(w, h);
  const rnd = mulberry32(opts.seed ?? 1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = Math.max(4, h * 0.04);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  }
  const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
  let y = (h - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.font = `${l.weight ?? 800} ${l.size}px ${l.font === 'display' ? DISPLAY_FONT : SIGN_FONT}`;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, w / 2, y, w * 0.92);
    y += l.size * 1.15;
  }
  if (opts.grime !== false) {
    speckle(ctx, w, h, w * h * 0.02, rnd, 0.18);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(40,30,20,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  return finish(c, false);
}

/** Tiling normal map for the sea (layered directional waves). */
export function waterNormalTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const waves = [
    [3, 1, 0.9],
    [1, 4, 0.6],
    [5, -3, 0.4],
    [-7, 2, 0.25],
    [9, 7, 0.15],
  ] as const;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, a] of waves) {
        const ph = ((kx * x + ky * y) / S) * Math.PI * 2;
        const d = Math.cos(ph) * a;
        dx += d * kx;
        dy += d * ky;
      }
      const nx = -dx * 0.05;
      const ny = -dy * 0.05;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, true, false);
}
