import type * as THREE from 'three/webgpu';
import type { LaneGraph } from '../world/roads/LaneGraph';

export interface Blip {
  x: number;
  z: number;
  kind: 'police' | 'shop' | 'restaurant' | 'mission' | 'landmark' | 'pickup';
  label?: string;
}

/**
 * Semi-transparent radar in the bottom-left corner (CLAUDE.md §4.8: minimap
 * rendered from the road graph). It rotates with the camera, so "up" is where
 * you're looking. Roads are bucketed into a grid so only nearby segments draw.
 */
const RANGE = 220;
const CELL = 100;

export class Minimap {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly segs = new Map<string, Array<[number, number, number, number, number]>>();
  private timer = 0;
  private flash = 0;
  private readonly size = 210;

  constructor(parent: HTMLElement, graph: LaneGraph) {
    this.el = document.createElement('canvas');
    this.el.id = 'minimap';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = this.size * dpr;
    this.el.height = this.size * dpr;
    this.el.style.width = `${this.size}px`;
    this.el.style.height = `${this.size}px`;
    parent.appendChild(this.el);
    this.ctx = this.el.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    for (const n of graph.nodes) {
      for (const l of n.links) {
        if (l.to < n.id) continue;
        const b = graph.nodes[l.to]!.p;
        const key = `${Math.floor(n.p.x / CELL)}:${Math.floor(n.p.z / CELL)}`;
        const list = this.segs.get(key) ?? [];
        list.push([n.p.x, n.p.z, b.x, b.z, l.width]);
        this.segs.set(key, list);
      }
    }
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? 'block' : 'none';
  }

  update(dt: number, player: THREE.Vector3, playerYaw: number, camYaw: number, blips: Blip[]): void {
    this.flash += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 20;
    const c = this.ctx;
    const S = this.size;
    const half = S / 2;
    const scale = half / RANGE;
    // Screen axes from the camera: right = (-cos, sin), forward = (sin, cos).
    const rx = -Math.cos(camYaw);
    const rz = Math.sin(camYaw);
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - player.x;
      const dz = z - player.z;
      return [half + (dx * rx + dz * rz) * scale, half - (dx * fx + dz * fz) * scale];
    };
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.roundRect(0, 0, S, S, 14);
    c.clip();
    c.fillStyle = 'rgba(18, 24, 30, 0.55)';
    c.fillRect(0, 0, S, S);
    // Roads.
    c.lineCap = 'round';
    const cx = Math.floor(player.x / CELL);
    const cz = Math.floor(player.z / CELL);
    const r = Math.ceil(RANGE / CELL) + 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.segs.get(`${cx + dx}:${cz + dz}`);
        if (!list) continue;
        for (const [x1, z1, x2, z2, w] of list) {
          const [a1, b1] = toScreen(x1, z1);
          const [a2, b2] = toScreen(x2, z2);
          c.strokeStyle = w >= 10 ? 'rgba(255, 214, 120, 0.75)' : 'rgba(220, 225, 230, 0.6)';
          c.lineWidth = Math.max(1.2, w * scale * 0.9);
          c.beginPath();
          c.moveTo(a1, b1);
          c.lineTo(a2, b2);
          c.stroke();
        }
      }
    }
    // Blips (clamped to the edge when off-map).
    for (const b of blips) {
      let [x, y] = toScreen(b.x, b.z);
      const ox = x - half;
      const oy = y - half;
      const lim = half - 9;
      const m = Math.max(Math.abs(ox), Math.abs(oy));
      const offMap = m > lim;
      if (offMap && b.kind !== 'mission' && b.kind !== 'landmark' && b.kind !== 'police') continue;
      if (offMap) {
        x = half + (ox / m) * lim;
        y = half + (oy / m) * lim;
      }
      if (b.kind === 'police') {
        c.fillStyle = Math.floor(this.flash * 6) % 2 ? '#ff3b30' : '#2f6bff';
        c.beginPath();
        c.arc(x, y, 5, 0, Math.PI * 2);
        c.fill();
      } else if (b.kind === 'mission') {
        c.fillStyle = '#ffcf1a';
        c.strokeStyle = '#121212';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, 6.5, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      } else if (b.kind === 'shop' || b.kind === 'restaurant') {
        c.fillStyle = b.kind === 'restaurant' ? '#ff9f43' : '#7ee08a';
        c.font = '700 11px Mukta, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('₹', x, y);
      } else if (b.kind === 'pickup') {
        c.fillStyle = '#74b9ff';
        c.fillRect(x - 3, y - 3, 6, 6);
      } else {
        c.fillStyle = '#ffffff';
        c.font = '800 10px Mukta, sans-serif';
        c.textAlign = 'center';
        c.fillText(b.label ?? '★', x, y);
      }
    }
    // Player arrow (relative to the camera heading).
    const rel = playerYaw - camYaw;
    c.save();
    c.translate(half, half);
    c.rotate(-rel);
    c.fillStyle = '#ffcf1a';
    c.strokeStyle = '#121212';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(6, 6);
    c.lineTo(0, 3);
    c.lineTo(-6, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // North marker.
    const [nx, ny] = toScreen(player.x, player.z - RANGE * 2);
    const ang = Math.atan2(ny - half, nx - half);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '800 11px Mukta, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', half + Math.cos(ang) * (half - 10), half + Math.sin(ang) * (half - 10));
    c.restore();
  }
}
