import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../render/materials/textures';

/**
 * Modular shop prop kit (SCENARIOS.md A2). Static pieces go into a
 * vertex-coloured batch that merges into one draw call per material; props
 * that move or get handed around (drawer, fan, newspaper, notes, coins, bag,
 * stock items) are their own small meshes with named interaction points.
 * All coordinates are in the room frame (metres, origin at the doorway).
 */
export class Batch {
  private readonly geos: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4): void {
    const geo = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    if (!geo.getAttribute('uv'))
      geo.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2),
      );
    if (m) geo.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    for (const k of Object.keys(geo.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
    this.geos.push(geo);
  }

  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: THREE.ColorRepresentation,
    rotY = 0,
  ): void {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(new THREE.BoxGeometry(w, h, d), color, m);
  }

  cyl(
    x: number,
    y: number,
    z: number,
    rTop: number,
    rBot: number,
    h: number,
    color: THREE.ColorRepresentation,
    seg = 10,
  ): void {
    this.add(
      new THREE.CylinderGeometry(rTop, rBot, h, seg),
      color,
      new THREE.Matrix4().makeTranslation(x, y, z),
    );
  }

  get empty(): boolean {
    return this.geos.length === 0;
  }

  build(mat: THREE.Material): THREE.Mesh {
    const g = mergeGeometries(this.geos, false)!;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

// ---- Canvas textures (original art) ----------------------------------------

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function terrazzoTexture(): THREE.Texture {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#c9bca6';
    c.fillRect(0, 0, 512, 512);
    const r = mulberry32(77);
    for (let i = 0; i < 2600; i++) {
      const pal = ['#8c7f6a', '#e8e0d0', '#6b5e4a', '#a7967c', '#f3ede2', '#7a8a78'];
      c.fillStyle = pal[Math.floor(r() * pal.length)]!;
      const s = 1 + r() * 4;
      c.beginPath();
      c.ellipse(r() * 512, r() * 512, s, s * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = 'rgba(60,50,40,0.35)';
    c.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, 512);
      c.moveTo(0, i);
      c.lineTo(512, i);
      c.stroke();
    }
  });
}

export function calendarTexture(): THREE.Texture {
  return canvasTex(256, 384, (c) => {
    c.fillStyle = '#fff8ec';
    c.fillRect(0, 0, 256, 384);
    const g = c.createLinearGradient(0, 0, 0, 190);
    g.addColorStop(0, '#ff9e3d');
    g.addColorStop(1, '#ffd36b');
    c.fillStyle = g;
    c.fillRect(10, 10, 236, 180);
    // Lotus over water (original art).
    c.fillStyle = '#2a7f8f';
    c.fillRect(10, 150, 236, 40);
    c.fillStyle = '#e8437a';
    for (let i = -3; i <= 3; i++) {
      c.beginPath();
      c.ellipse(128 + i * 13, 128, 9, 32, i * 0.28, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#b71c1c';
    c.font = 'bold 22px sans-serif';
    c.textAlign = 'center';
    c.fillText('LAXMI GENERAL STORES', 128, 214);
    c.fillStyle = '#333';
    c.font = 'bold 16px sans-serif';
    c.fillText('NOVEMBER 2026', 128, 240);
    c.font = '13px sans-serif';
    for (let d = 1; d <= 30; d++) {
      const col = (d + 6) % 7;
      const row = Math.floor((d + 6) / 7);
      c.fillStyle = col === 0 ? '#c62828' : '#333';
      c.fillText(String(d), 30 + col * 33, 250 + row * 24);
    }
  });
}

export function priceBoardTexture(): THREE.Texture {
  return canvasTex(512, 256, (c) => {
    c.fillStyle = '#20302a';
    c.fillRect(0, 0, 512, 256);
    c.strokeStyle = '#8d6e4a';
    c.lineWidth = 14;
    c.strokeRect(0, 0, 512, 256);
    c.fillStyle = '#f2efe6';
    c.font = 'bold 26px sans-serif';
    c.fillText('आजचे भाव · TODAY’S RATE', 28, 46);
    c.font = '24px sans-serif';
    const rows = [
      ['तांदूळ  Rice', '₹70/kg'],
      ['तूर डाळ  Toor dal', '₹150/kg'],
      ['साखर  Sugar', '₹46/kg'],
      ['गहू आटा  Atta', '₹52/kg'],
    ];
    rows.forEach(([a, b], i) => {
      c.fillText(a!, 28, 92 + i * 40);
      c.fillText(b!, 380, 92 + i * 40);
    });
  });
}

export function newspaperTexture(): THREE.Texture {
  return canvasTex(256, 192, (c) => {
    c.fillStyle = '#e9e4d6';
    c.fillRect(0, 0, 256, 192);
    c.fillStyle = '#1b1b1b';
    c.font = 'bold 22px serif';
    c.fillText('BAMBAI DAILY', 12, 28);
    c.fillRect(12, 34, 232, 2);
    c.font = 'bold 13px serif';
    c.fillText('MONSOON FAREWELL, CITY SMILES', 12, 54);
    const r = mulberry32(5);
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 14; row++) c.fillRect(12 + col * 80, 64 + row * 9, 50 + r() * 22, 3);
  });
}

export function altarPictureTexture(): THREE.Texture {
  return canvasTex(128, 160, (c) => {
    const g = c.createRadialGradient(64, 70, 6, 64, 70, 80);
    g.addColorStop(0, '#fff3b0');
    g.addColorStop(1, '#e65100');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 160);
    c.fillStyle = '#c2185b';
    for (let i = 0; i < 8; i++) {
      c.save();
      c.translate(64, 96);
      c.rotate((i / 8) * Math.PI * 2);
      c.beginPath();
      c.ellipse(0, -18, 7, 18, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    c.fillStyle = '#7a1f00';
    c.font = 'bold 44px serif';
    c.textAlign = 'center';
    c.fillText('ॐ', 64, 52);
  });
}

// ---- Dynamic props -----------------------------------------------------------

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function propMat(
  color: THREE.ColorRepresentation,
  roughness = 0.7,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${roughness}|${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    m.envMapIntensity = 0.45;
    matCache.set(key, m);
  }
  return m;
}

/** Note colours by denomination (₹). */
export const NOTE_COLORS: Record<number, number> = {
  500: 0xb7b3a4,
  200: 0xf0b13c,
  100: 0xa99bd1,
  50: 0x7fd1d6,
  20: 0xc8d66a,
  10: 0x9b6a45,
};

export function makeNote(denom: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.003, 0.068),
    propMat(NOTE_COLORS[denom] ?? 0xcccccc, 0.9),
  );
  m.userData.kind = 'note';
  m.userData.denom = denom;
  return m;
}

/** A rubber-banded bundle (for the galla contents and, later, robberies). */
export function makeBundle(denom: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(0.15, 0.025, 0.068);
  const m = new THREE.Mesh(g, propMat(NOTE_COLORS[denom] ?? 0xcccccc, 0.85));
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.027, 0.07), propMat(0x8b1a1a, 0.6));
  m.add(band);
  m.userData.kind = 'bundle';
  m.userData.denom = denom;
  return m;
}

const coinGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.0025, 14);
export function makeCoin(value: number): THREE.Mesh {
  const gold = value === 10 || value === 2;
  const m = new THREE.Mesh(coinGeo, propMat(gold ? 0xd6b45a : 0xc8c8c8, 0.35, { metalness: 0.9 }));
  m.userData.kind = 'coin';
  m.userData.value = value;
  return m;
}

/** Thin plastic carry bag with two handles (pivot at the handles, so it hangs from a hand). */
export function makeBag(): THREE.Object3D {
  const root = new THREE.Object3D();
  const mat = propMat(0xf4f1ea, 0.5, { transparent: true, opacity: 0.88 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.1), mat);
  body.position.y = -0.17;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 4, 10, Math.PI), mat);
  handle.position.y = -0.04;
  root.add(body, handle);
  root.userData.kind = 'bag';
  return root;
}

export function makeNewspaper(): THREE.Mesh {
  const tex = newspaperTexture();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.004, 0.25), propMat(0xffffff, 0.95, { map: tex }));
  m.userData.kind = 'newspaper';
  return m;
}

export function makeNotepad(): THREE.Object3D {
  const root = new THREE.Object3D();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.14), propMat(0xfbf6e3, 0.9));
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 6), propMat(0xf2c12e, 0.6));
  pencil.rotation.z = Math.PI / 2;
  pencil.position.set(0.0, 0.008, 0.08);
  root.add(pad, pencil);
  root.userData.kind = 'notepad';
  return root;
}

/** Hero stock item meshes (the ones you can pick up). Pivot at the base centre. */
export function makeStockItem(kind: string, color: string): THREE.Object3D {
  const root = new THREE.Object3D();
  const c = new THREE.Color(color);
  const label = new THREE.Color(0xffffff);
  const add = (g: THREE.BufferGeometry, col: THREE.Color, y: number, rough = 0.6, extra = {}): void => {
    const m = new THREE.Mesh(g, propMat(col, rough, extra));
    m.position.y = y;
    root.add(m);
  };
  switch (kind) {
    case 'packet':
      add(new THREE.BoxGeometry(0.15, 0.05, 0.07), c, 0.025);
      add(new THREE.BoxGeometry(0.06, 0.051, 0.071), new THREE.Color(0xc62828), 0.025);
      break;
    case 'pillow':
      add(new THREE.BoxGeometry(0.13, 0.19, 0.045), c, 0.095, 0.35, { metalness: 0.3 });
      add(new THREE.BoxGeometry(0.08, 0.06, 0.047), new THREE.Color(0xffd54f), 0.1, 0.4);
      break;
    case 'soap':
      add(new THREE.BoxGeometry(0.09, 0.035, 0.06), c, 0.0175);
      break;
    case 'slim':
      add(new THREE.BoxGeometry(0.05, 0.22, 0.022), c, 0.11);
      add(new THREE.BoxGeometry(0.051, 0.05, 0.023), label, 0.15);
      break;
    case 'bottle':
      add(new THREE.CylinderGeometry(0.03, 0.033, 0.19, 12), c, 0.095, 0.15, {
        transparent: true,
        opacity: 0.85,
      });
      add(new THREE.CylinderGeometry(0.012, 0.025, 0.06, 10), c, 0.22, 0.15, {
        transparent: true,
        opacity: 0.85,
      });
      add(new THREE.CylinderGeometry(0.031, 0.031, 0.05, 12), new THREE.Color(0xd32f2f), 0.11);
      break;
    case 'tin':
      add(new THREE.BoxGeometry(0.1, 0.2, 0.07), c, 0.1, 0.35, { metalness: 0.6 });
      add(new THREE.BoxGeometry(0.101, 0.08, 0.071), new THREE.Color(0x2e7d32), 0.1);
      break;
    case 'bag':
      add(new THREE.BoxGeometry(0.16, 0.22, 0.07), c, 0.11, 0.8);
      add(new THREE.BoxGeometry(0.161, 0.07, 0.071), new THREE.Color(0x1565c0), 0.13, 0.8);
      break;
    case 'matchbox':
      add(new THREE.BoxGeometry(0.05, 0.05, 0.07), c, 0.025);
      break;
    default:
      add(new THREE.BoxGeometry(0.1, 0.1, 0.1), c, 0.05);
  }
  root.userData.kind = 'stock';
  return root;
}

/** Filler stock colours for the instanced shelves. */
export const STOCK_COLORS = [
  0xf2c230, 0xe5482f, 0x3f9b4b, 0x1565c0, 0xffffff, 0xf57c00, 0x7b3fa0, 0xd81b60, 0x00897b, 0xfdd835,
  0x8d6e63, 0xc62828, 0x283593, 0xeeeeee,
];
