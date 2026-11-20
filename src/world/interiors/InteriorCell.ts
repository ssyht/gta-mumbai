import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { InteriorSlot } from '../buildings/StreetBuildings';
import { mulberry32 } from '../../render/materials/textures';
import { isOpen, type StockItem } from '../../gameplay/shop/ShopTransaction';
import {
  altarPictureTexture,
  Batch,
  calendarTexture,
  makeBundle,
  makeCoin,
  makeStockItem,
  priceBoardTexture,
  propMat,
  STOCK_COLORS,
  terrazzoTexture,
} from './ShopPropKit';

/** Data file shape (src/data/interiors/<id>.json). */
export interface InteriorData {
  id: string;
  title: string;
  dev: string;
  kind: string;
  hours: { open: string; close: string; closedDays: number[] };
  materials: { floor: string; walls: string; dado: string; ceiling: string };
  drawCallBudget: number;
  props: Array<Record<string, number | string> & { type: string; x: number; z: number }>;
  slots: {
    shopkeeper: { x: number; z: number; yaw: number };
    customerQueue: Array<{ x: number; z: number }>;
    browse: Array<{ x: number; z: number }>;
  };
  interaction: {
    counterFront: { x: number; z: number };
    counterTop: { x0: number; x1: number; z0: number; z1: number; cols: number; rows: number; y: number };
    drawerTravel: number;
  };
  stock: Array<StockItem & { mesh: string; color: string; x: number; z: number; level: number }>;
}

export interface StockSlot {
  item: StockItem;
  obj: THREE.Object3D;
  home: THREE.Vector3;
  homeParent: THREE.Object3D;
  taken: boolean;
}

const _v = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const RACK_H = 2.5;

/**
 * A walk-in interior (SCENARIOS.md A1): a real room inside the building's
 * footprint behind a real doorway. Renders only when the player is inside or
 * the doorway is in view within 25 m; a cheap plug card fills the doorway
 * otherwise. Owns the rolling shutter (opening hours), the room light, dust
 * motes in the door's sunbeam and the dynamic props scenarios drive.
 */
export class InteriorCell {
  readonly group = new THREE.Group();
  readonly frame: THREE.Matrix4;
  private readonly inv: THREE.Matrix4;
  /** 0 = outside, 1 = fully inside (eases over 0.4 s while crossing the threshold). */
  indoor = 0;
  inside = false;
  visible = true;
  open = true;
  readonly stock: StockSlot[] = [];
  readonly counterSlots: THREE.Vector3[] = [];
  /** Galla (cash drawer): `drawer` slides along +X by `drawerOpen` × travel. */
  readonly drawer = new THREE.Group();
  drawerOpen = 0;
  readonly drawerHandle = new THREE.Object3D();
  readonly drawerInside = new THREE.Object3D();
  readonly fan = new THREE.Group();
  fanSpeed = 9;
  readonly fridgeDoor = new THREE.Group();
  fridgeOpen = 0;
  altarFlame: THREE.Mesh = new THREE.Mesh();
  readonly altarPoint = new THREE.Vector3();
  readonly bagHook = new THREE.Object3D();
  readonly handset = new THREE.Object3D();
  readonly handsetHome = new THREE.Vector3();
  readonly notepadSpot = new THREE.Vector3();
  readonly newspaperSpot = new THREE.Vector3();
  readonly changeSpot = new THREE.Vector3();
  readonly lamp: THREE.PointLight;
  private readonly tubes: THREE.Mesh;
  private readonly plug: THREE.Mesh;
  private readonly shutter: THREE.Mesh;
  private shutterPos = 1; // 1 = rolled up (open)
  private readonly shutterCollider: RAPIER.Collider;
  private readonly motes: THREE.InstancedMesh;
  private readonly moteSeeds: Float32Array;
  private readonly doorWorld = new THREE.Vector3();
  private readonly drawerHome = new THREE.Vector3();
  private time = 0;
  /** Fired when the shutter starts moving (for the rattle sound). */
  onShutter: ((opening: boolean, at: THREE.Vector3) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    readonly slot: InteriorSlot,
    readonly data: InteriorData,
  ) {
    this.frame = slot.frame.clone();
    this.inv = this.frame.clone().invert();
    this.frame.decompose(this.group.position, this.group.quaternion, this.group.scale);
    this.group.name = `interior:${data.id}`;
    scene.add(this.group);
    const W = slot.roomW;
    const D = slot.roomD;
    const H = slot.roomH;
    const DW = slot.doorWidth;
    const M = data.materials;
    const rnd = mulberry32(data.id.length * 131 + 7);

    // ---- Shell ---------------------------------------------------------------
    const shell = new Batch();
    const T = 0.06;
    shell.box(-W / 2 - T / 2, H / 2, -D / 2, T, H, D, M.walls);
    shell.box(W / 2 + T / 2, H / 2, -D / 2, T, H, D, M.walls);
    shell.box(0, H / 2, -D - T / 2, W, H, T, M.walls);
    const side = (W - DW) / 2;
    shell.box(-W / 2 + side / 2, H / 2, -0.15, side, H, 0.3, M.walls);
    shell.box(W / 2 - side / 2, H / 2, -0.15, side, H, 0.3, M.walls);
    shell.box(0, H + T / 2, -D / 2, W + 0.12, T, D, M.ceiling);
    // Oil-paint dado band and skirting.
    shell.box(-W / 2 + 0.005, 0.55, -D / 2, 0.012, 1.1, D, M.dado);
    shell.box(W / 2 - 0.005, 0.55, -D / 2, 0.012, 1.1, D, M.dado);
    shell.box(0, 0.55, -D + 0.005, W, 1.1, 0.012, M.dado);
    // Damp stains near the floor.
    for (let i = 0; i < 4; i++)
      shell.box(
        -W / 2 + 0.012,
        0.25 + rnd() * 0.3,
        -1 - rnd() * 4,
        0.004,
        0.3 + rnd() * 0.3,
        0.4 + rnd() * 0.5,
        '#4f6e62',
      );
    // Wiring conduit along the ceiling and a switchboard.
    shell.box(-W / 2 + 0.03, H - 0.08, -D / 2, 0.025, 0.025, D, '#e7e2d6');
    shell.box(-W / 2 + 0.03, 1.45, -1.25, 0.025, 0.18, 0.3, '#f4efe2');

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2).translate(0, 0.002, -D / 2),
      propMat(M.floor, 0.55, { map: terrazzoTexture() }),
    );
    (floor.material as THREE.MeshStandardMaterial).map!.wrapS = THREE.RepeatWrapping;
    (floor.material as THREE.MeshStandardMaterial).map!.wrapT = THREE.RepeatWrapping;
    (floor.material as THREE.MeshStandardMaterial).map!.repeat.set(W / 1.6, D / 1.6);
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---- Props ---------------------------------------------------------------
    const filler: Array<{ m: THREE.Matrix4; c: THREE.Color }> = [];
    const glass: THREE.Mesh[] = [];
    const ct = data.interaction.counterTop;
    const drawerTravel = data.interaction.drawerTravel;
    for (const p of data.props) {
      const x = p.x;
      const z = p.z;
      const num = (k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
      switch (p.type) {
        case 'counter':
        case 'counterReturn': {
          const w = num('w');
          const d = num('d');
          const h = num('h', 0.95);
          // Painted plywood front, teak top rim, glass display top with goods under it.
          shell.box(x, (h - 0.12) / 2, z, w, h - 0.12, d, '#3d6fa8');
          shell.box(x, h - 0.06, z, w + 0.04, 0.02, d + 0.04, '#6b4423');
          shell.box(x - w / 2 - 0.004, 0.45, z, 0.008, 0.08, d, '#f2c12e');
          for (let i = 0; i < Math.floor(d / 0.3); i++)
            shell.box(
              x + (rnd() - 0.5) * (w - 0.15),
              h - 0.1,
              z - d / 2 + 0.15 + i * 0.3,
              0.1,
              0.05,
              0.08,
              STOCK_COLORS[Math.floor(rnd() * STOCK_COLORS.length)]!,
            );
          const g = new THREE.Mesh(
            new THREE.BoxGeometry(w, 0.012, d).translate(x, h - 0.006, z),
            propMat(0xbfe3e0, 0.05, { transparent: true, opacity: 0.35, metalness: 0.1 }),
          );
          glass.push(g);
          physics.addStaticBox(
            this.toWorld(_v.set(x, h / 2, z)),
            { x: w / 2, y: h / 2, z: d / 2 },
            this.worldQuat(),
          );
          break;
        }
        case 'galla': {
          // Drawer under the counter top on the shopkeeper's side; slides toward +X.
          const y = num('y', 0.78);
          const tray = new Batch();
          tray.box(0, -0.045, 0, 0.36, 0.01, 0.42, '#5b3a1e');
          tray.box(-0.175, 0, 0, 0.01, 0.1, 0.42, '#5b3a1e');
          tray.box(0.18, 0, 0, 0.02, 0.11, 0.44, '#7a5230');
          tray.box(0, 0, -0.205, 0.36, 0.1, 0.01, '#5b3a1e');
          tray.box(0, 0, 0.205, 0.36, 0.1, 0.01, '#5b3a1e');
          // Compartment dividers.
          tray.box(0, -0.02, -0.07, 0.34, 0.05, 0.006, '#4a2f18');
          tray.box(0, -0.02, 0.07, 0.34, 0.05, 0.006, '#4a2f18');
          const trayMesh = tray.build(propMat(0xffffff, 0.75, { vertexColors: true }));
          this.drawer.add(trayMesh);
          this.drawerHandle.position.set(0.2, 0.0, 0);
          this.drawer.add(this.drawerHandle);
          this.drawerInside.position.set(0, -0.035, 0);
          this.drawer.add(this.drawerInside);
          // Real contents: bundles and coins.
          [500, 200, 100, 100, 50].forEach((d, i) => {
            const b = makeBundle(d);
            b.position.set(-0.08 + (i % 2) * 0.12, -0.025 + Math.floor(i / 2) * 0.026, -0.14 + (i % 3) * 0.0);
            b.rotation.y = Math.PI / 2;
            b.position.z = -0.14 + (i % 3) * 0.002;
            this.drawerInside.add(b);
          });
          for (let i = 0; i < 9; i++) {
            const cn = makeCoin([1, 2, 5, 10][i % 4]!);
            cn.position.set(-0.12 + rnd() * 0.24, -0.008, 0.1 + rnd() * 0.08);
            this.drawerInside.add(cn);
          }
          this.drawerHome.set(x - 0.18 + 0.02, y, z);
          this.drawer.position.copy(this.drawerHome);
          this.group.add(this.drawer);
          void drawerTravel;
          break;
        }
        case 'rack':
        case 'woodRack': {
          const w = num('w');
          const d = num('d');
          const levels = num('levels', 5);
          const facing = num('facing', 1);
          const wood = p.type === 'woodRack';
          const frame = wood ? '#6d4c33' : '#9aa3a8';
          const along = facing === 1 || facing === 3 ? d : w;
          const deep = facing === 1 || facing === 3 ? w : d;
          const ax = facing === 1 || facing === 3 ? 'z' : 'x';
          for (const s of [-1, 1])
            for (const f of [-1, 1]) {
              const px = ax === 'z' ? x + f * (deep / 2 - 0.02) : x + s * (along / 2 - 0.02);
              const pz = ax === 'z' ? z + s * (along / 2 - 0.02) : z + f * (deep / 2 - 0.02);
              shell.box(px, RACK_H / 2, pz, 0.035, RACK_H, 0.035, frame);
            }
          for (let k = 0; k < levels; k++) {
            const y = 0.12 + k * (RACK_H / levels);
            if (ax === 'z') shell.box(x, y, z, deep, 0.025, along, frame);
            else shell.box(x, y, z, along, 0.025, deep, frame);
            // Filler stock along the level.
            let t = -along / 2 + 0.06;
            while (t < along / 2 - 0.08) {
              const sw = 0.06 + rnd() * 0.12;
              const sh = 0.06 + rnd() * Math.min(0.26, RACK_H / levels - 0.12);
              const sd = 0.06 + rnd() * (deep - 0.22);
              if (rnd() < 0.88) {
                const px =
                  ax === 'z' ? x + (facing === 1 ? -1 : 1) * (deep / 2 - sd / 2 - 0.03) : x + t + sw / 2;
                const pz =
                  ax === 'z' ? z + t + sw / 2 : z + (facing === 2 ? -1 : 1) * (deep / 2 - sd / 2 - 0.03);
                const m = new THREE.Matrix4().compose(
                  new THREE.Vector3(px, y + 0.0125 + sh / 2, pz),
                  new THREE.Quaternion(),
                  ax === 'z' ? new THREE.Vector3(sd, sh, sw) : new THREE.Vector3(sw, sh, sd),
                );
                const c = new THREE.Color(STOCK_COLORS[Math.floor(rnd() * STOCK_COLORS.length)]!);
                const run = 1 + Math.floor(rnd() * 3);
                for (let r = 0; r < run && t < along / 2 - 0.08; r++) {
                  const mm = m.clone();
                  if (ax === 'z') mm.elements[14] = z + t + sw / 2;
                  else mm.elements[12] = x + t + sw / 2;
                  filler.push({ m: mm, c });
                  t += sw + 0.01;
                }
              } else t += sw + 0.02;
            }
          }
          const ext =
            ax === 'z'
              ? { x: deep / 2, y: RACK_H / 2, z: along / 2 }
              : { x: along / 2, y: RACK_H / 2, z: deep / 2 };
          physics.addStaticBox(this.toWorld(_v.set(x, RACK_H / 2, z)), ext, this.worldQuat());
          break;
        }
        case 'fridge': {
          shell.box(x, 0.95, z, 0.62, 1.9, 0.6, '#f4f4f2');
          shell.box(x, 1.95, z, 0.62, 0.1, 0.6, '#c62828');
          for (let k = 0; k < 4; k++) {
            shell.box(x, 0.35 + k * 0.4, z, 0.5, 0.015, 0.5, '#dfe6e8');
            for (let b = 0; b < 5; b++)
              shell.cyl(
                x - 0.04,
                0.47 + k * 0.4,
                z - 0.2 + b * 0.1,
                0.03,
                0.033,
                0.22,
                ['#5a1d12', '#2e7d32', '#ff8f00', '#1565c0'][k]!,
                8,
              );
          }
          // Hinged glass door on the +X face (facing the aisle).
          const door = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, 1.7, 0.56).translate(0, 0, 0.28),
            propMat(0xd9f1ff, 0.05, { transparent: true, opacity: 0.3 }),
          );
          const rim = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 1.72, 0.04).translate(0, 0, 0.55),
            propMat(0xb0b0b0, 0.4, { metalness: 0.6 }),
          );
          this.fridgeDoor.add(door, rim);
          this.fridgeDoor.position.set(x + 0.32, 1.0, z - 0.28);
          this.group.add(this.fridgeDoor);
          physics.addStaticBox(
            this.toWorld(_v.set(x, 0.95, z)),
            { x: 0.31, y: 0.95, z: 0.3 },
            this.worldQuat(),
          );
          break;
        }
        case 'sack': {
          const col = String(p.color ?? '#e8dcc0');
          shell.cyl(x, 0.3, z, 0.2, 0.24, 0.6, '#c9b48a', 12);
          shell.cyl(x, 0.62, z, 0.22, 0.2, 0.06, '#b8a074', 12);
          shell.cyl(x, 0.6, z, 0.19, 0.19, 0.03, col, 12);
          shell.box(x + 0.05, 0.64, z + 0.04, 0.08, 0.03, 0.12, '#c0c0c0', 0.4);
          physics.addStaticCylinder(this.toWorld(_v.set(x, 0.33, z)), 0.33, 0.23);
          break;
        }
        case 'altar': {
          const y = num('y', 2.3);
          shell.box(x - 0.05, y, z, 0.2, 0.03, 0.5, '#6d4c33');
          const pic = new THREE.Mesh(
            new THREE.PlaneGeometry(0.22, 0.28),
            propMat(0xffffff, 0.6, { map: altarPictureTexture() }),
          );
          pic.position.set(x + 0.04, y + 0.17, z);
          pic.rotation.y = -Math.PI / 2;
          this.group.add(pic);
          shell.box(x + 0.045, y + 0.17, z, 0.01, 0.31, 0.25, '#c9a227');
          // Marigold garland draped over the frame.
          for (let i = 0; i <= 12; i++) {
            const a = (i / 12) * Math.PI;
            shell.add(
              new THREE.SphereGeometry(0.017, 6, 4),
              i % 2 ? '#ff9800' : '#ffd600',
              new THREE.Matrix4().makeTranslation(
                x + 0.03,
                y + 0.31 - Math.sin(a) * 0.17,
                z - Math.cos(a) * 0.13,
              ),
            );
          }
          // Diya: clay lamp with a flickering flame.
          shell.cyl(x - 0.02, y + 0.03, z + 0.18, 0.035, 0.02, 0.025, '#a0522d', 10);
          this.altarFlame = new THREE.Mesh(
            new THREE.ConeGeometry(0.008, 0.03, 6),
            new THREE.MeshBasicMaterial({ color: 0xffb347 }),
          );
          this.altarFlame.position.set(x - 0.02, y + 0.06, z + 0.18);
          this.group.add(this.altarFlame);
          this.altarPoint.set(x - 0.02, y + 0.06, z + 0.06);
          break;
        }
        case 'fan': {
          shell.cyl(x, H - 0.2, z, 0.012, 0.012, 0.4, '#5d4037', 6);
          const fanMesh = new Batch();
          fanMesh.cyl(0, 0, 0, 0.1, 0.1, 0.09, '#6d4c41', 12);
          for (let b = 0; b < 3; b++) {
            const a = (b / 3) * Math.PI * 2;
            const m = new THREE.Matrix4().compose(
              new THREE.Vector3(Math.cos(a) * 0.42, -0.01, Math.sin(a) * 0.42),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, -a, 0)),
              new THREE.Vector3(1, 1, 1),
            );
            fanMesh.add(new THREE.BoxGeometry(0.64, 0.008, 0.11), '#7b5e45', m);
          }
          this.fan.add(fanMesh.build(propMat(0xffffff, 0.6, { vertexColors: true })));
          this.fan.position.set(x, H - 0.42, z);
          this.group.add(this.fan);
          break;
        }
        case 'tube': {
          // Emissive tubes are collected below into one mesh.
          break;
        }
        case 'calendar': {
          const cal = new THREE.Mesh(
            new THREE.PlaneGeometry(0.34, 0.5),
            propMat(0xffffff, 0.8, { map: calendarTexture() }),
          );
          cal.position.set(x, num('y', 1.7), z - 0.01);
          cal.rotation.y = Math.PI;
          this.group.add(cal);
          break;
        }
        case 'priceBoard': {
          const b = new THREE.Mesh(
            new THREE.PlaneGeometry(0.9, 0.45),
            propMat(0xffffff, 0.9, { map: priceBoardTexture() }),
          );
          b.position.set(x, num('y', 2.6), z + 0.02);
          this.group.add(b);
          break;
        }
        case 'stool': {
          shell.cyl(x, 0.6, z, 0.17, 0.17, 0.035, '#1565c0', 14);
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + 0.4;
            shell.box(x + Math.cos(a) * 0.12, 0.3, z + Math.sin(a) * 0.12, 0.025, 0.6, 0.025, '#0d47a1');
          }
          break;
        }
        case 'scale': {
          const y = 0.95;
          shell.box(x, y + 0.04, z, 0.22, 0.08, 0.2, '#e0e0e0');
          shell.cyl(x, y + 0.09, z, 0.12, 0.12, 0.012, '#bdbdbd', 16);
          shell.box(x - 0.11, y + 0.04, z, 0.005, 0.04, 0.08, '#263238');
          break;
        }
        case 'phone': {
          const y = 0.95;
          shell.box(x, y + 0.015, z, 0.1, 0.03, 0.14, '#212121');
          this.handset.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.16), propMat(0x424242, 0.5)));
          this.handsetHome.set(x, y + 0.045, z + 0.01);
          this.handset.position.copy(this.handsetHome);
          this.group.add(this.handset);
          break;
        }
        case 'chips': {
          // Hanging strip of chips packets near the door.
          shell.box(x, H - 0.3, z, 0.9, 0.01, 0.01, '#9e9e9e');
          for (let i = 0; i < 15; i++)
            shell.box(
              x - 0.4 + Math.floor(i / 3) * 0.2,
              H - 0.42 - (i % 3) * 0.19,
              z,
              0.12,
              0.17,
              0.035,
              ['#e5482f', '#fdd835', '#1e88e5', '#43a047'][i % 4]!,
            );
          break;
        }
      }
    }
    // Stock collision-free: hero items.
    for (const s of data.stock) {
      const obj = makeStockItem(s.mesh, s.color);
      let home: THREE.Vector3;
      let parent: THREE.Object3D = this.group;
      if (s.level < 0) {
        // Inside the fridge, behind the glass door.
        home = new THREE.Vector3(s.x + 0.12, 1.16, s.z + 0.05);
        parent = this.group;
      } else {
        const rack = data.props.find(
          (p) =>
            (p.type === 'rack' || p.type === 'woodRack') &&
            Math.abs(p.x - s.x) < 0.6 &&
            Math.abs(p.z - s.z) < (Number(p.d) || 1) / 2 + 0.6,
        );
        const levels = Number(rack?.levels ?? 6);
        const y = 0.12 + s.level * (RACK_H / levels) + 0.0125;
        home = new THREE.Vector3(s.x, y, s.z);
      }
      obj.position.copy(home);
      parent.add(obj);
      this.stock.push({
        item: { id: s.id, name: s.name, dev: s.dev, price: s.price, ...(s.heal ? { heal: s.heal } : {}) },
        obj,
        home,
        homeParent: parent,
        taken: false,
      });
    }

    // Counter-top drop slots (4 × 3 grid).
    for (let r = 0; r < ct.rows; r++)
      for (let c = 0; c < ct.cols; c++)
        this.counterSlots.push(
          new THREE.Vector3(
            ct.x0 + ((r + 0.5) / ct.rows) * (ct.x1 - ct.x0),
            ct.y + 0.002,
            ct.z0 + ((c + 0.5) / ct.cols) * (ct.z1 - ct.z0),
          ),
        );
    this.notepadSpot.set(ct.x1 - 0.04, ct.y + 0.004, ct.z1 - 0.2);
    this.newspaperSpot.set(ct.x1 - 0.05, ct.y + 0.003, ct.z0 - 0.45);
    this.changeSpot.set(ct.x0 + 0.04, ct.y + 0.002, (ct.z0 + ct.z1) / 2);
    this.bagHook.position.set(ct.x1 + 0.12, 0.6, ct.z0 + 0.1);
    this.group.add(this.bagHook);

    // Filler stock: one instanced draw call.
    const fill = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      propMat(0xffffff, 0.7),
      filler.length,
    );
    filler.forEach((f, i) => {
      fill.setMatrixAt(i, f.m);
      fill.setColorAt(i, f.c);
    });
    fill.castShadow = true;
    fill.receiveShadow = true;
    this.group.add(fill);

    const shellMesh = shell.build(propMat(0xffffff, 0.85, { vertexColors: true }));
    this.group.add(shellMesh);
    for (const g of glass) this.group.add(g);

    // Tube lights (one emissive mesh) and the room lamp.
    const tb = new Batch();
    for (const p of data.props.filter((p) => p.type === 'tube')) {
      const f = Number(p.facing ?? 1);
      tb.box(p.x + (f === 1 ? 0.05 : -0.05), Number(p.y ?? 2.8), p.z, 0.035, 0.035, 1.2, '#ffffff');
    }
    this.tubes = tb.build(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xeaf6ff,
        emissiveIntensity: 1.2,
        roughness: 0.3,
      }),
    );
    this.tubes.castShadow = false;
    this.group.add(this.tubes);
    this.lamp = new THREE.PointLight(0xeef6ff, 0, 9, 1.6);
    this.lamp.position.set(0.2, H - 0.35, -2.6);
    this.group.add(this.lamp);

    // Rolling shutter across the doorway (down when the shop is closed).
    this.shutter = new THREE.Mesh(
      new THREE.PlaneGeometry(DW, H).translate(0, -H / 2, 0),
      propMat(0x6e7b80, 0.55, { metalness: 0.6, side: THREE.DoubleSide }),
    );
    this.shutter.position.set(0, H, 0.03);
    this.group.add(this.shutter);
    this.shutterCollider = physics.addStaticBox(
      this.toWorld(_v.set(0, H / 2, 0.0)),
      { x: DW / 2, y: H / 2, z: 0.05 },
      this.worldQuat(),
    );
    this.shutterCollider.setEnabled(false);

    // Doorway plug: warm dim interior card shown when the room itself is culled.
    this.plug = new THREE.Mesh(
      new THREE.PlaneGeometry(DW, H - 0.1),
      new THREE.MeshBasicMaterial({ color: 0x3a2a1c }),
    );
    this.plug.position.set(0, (H - 0.1) / 2, -0.7);
    this.toWorld(this.doorWorld.set(0, 1.4, 0));
    scene.add(this.plug);
    this.plug.matrixAutoUpdate = false;
    this.plug.matrix.copy(this.frame).multiply(new THREE.Matrix4().makeTranslation(0, (H - 0.1) / 2, -0.7));
    this.plug.visible = false;

    // Dust motes drifting in the door's sunbeam.
    const N = 70;
    this.motes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.004, 4, 3),
      new THREE.MeshBasicMaterial({
        color: 0xfff1d0,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      N,
    );
    this.moteSeeds = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) this.moteSeeds[i] = rnd();
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  worldQuat(): { x: number; y: number; z: number; w: number } {
    const q = this.group.quaternion;
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  toWorld(local: THREE.Vector3, out = local): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.frame);
  }

  toLocal(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(world).applyMatrix4(this.inv);
  }

  /** World yaw of a direction given in the room frame. */
  yawOf(localYaw: number): number {
    const e = new THREE.Euler().setFromQuaternion(this.group.quaternion, 'YXZ');
    return e.y + localYaw;
  }

  containsLocal(p: THREE.Vector3, margin = 0): boolean {
    const W = this.slot.roomW;
    return (
      Math.abs(p.x) < W / 2 - margin &&
      p.z < -margin &&
      p.z > -this.slot.roomD + margin &&
      p.y > -0.5 &&
      p.y < this.slot.roomH
    );
  }

  get doorPosition(): THREE.Vector3 {
    return this.doorWorld;
  }

  /** Hero stock item under a world-space ray (the crosshair), within reach. */
  pickStock(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 3.2): StockSlot | null {
    let best: StockSlot | null = null;
    let bd = maxDist;
    const p = new THREE.Vector3();
    for (const s of this.stock) {
      if (s.taken || !s.obj.parent || s.obj.parent !== s.homeParent) continue;
      s.obj.getWorldPosition(p);
      p.y += 0.08;
      const t = p.clone().sub(origin).dot(dir);
      if (t < 0 || t > bd) continue;
      const off = origin.clone().addScaledVector(dir, t).distanceTo(p);
      if (off < 0.12 + t * 0.02) {
        bd = t;
        best = s;
      }
    }
    return best;
  }

  update(
    dt: number,
    camera: THREE.Camera,
    player: THREE.Vector3,
    clockMinutes: number,
    weekday: number,
  ): void {
    this.time += dt;
    // Opening hours drive the shutter.
    const open = isOpen(
      clockMinutes,
      this.data.hours.open,
      this.data.hours.close,
      weekday,
      this.data.hours.closedDays,
    );
    if (open !== this.open) {
      this.open = open;
      this.onShutter?.(open, this.doorWorld);
    }
    const target = open ? 1 : 0;
    this.shutterPos +=
      Math.sign(target - this.shutterPos) * Math.min(Math.abs(target - this.shutterPos), dt / 1.6);
    const H = this.slot.roomH;
    this.shutter.scale.y = Math.max(0.03, 1 - this.shutterPos);
    this.shutter.visible = this.shutterPos < 0.995;
    this.shutterCollider.setEnabled(this.shutterPos < 0.5);
    void H;

    const local = this.toLocal(player);
    this.inside = this.containsLocal(local, 0.05);
    const k = dt / 0.4;
    this.indoor = THREE.MathUtils.clamp(this.indoor + (this.inside ? k : -k), 0, 1);

    // Portal culling: inside, or the doorway in view within 25 m.
    const cam = camera as THREE.PerspectiveCamera;
    let vis = this.inside || this.indoor > 0;
    if (!vis && cam.position.distanceTo(this.doorWorld) < 25) {
      _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pm);
      _sphere.set(this.doorWorld, Math.max(2, this.slot.doorWidth));
      vis = _frustum.intersectsSphere(_sphere);
    }
    this.visible = vis;
    this.group.visible = vis;
    this.plug.visible = !vis && this.shutterPos > 0.05;
    if (!vis) {
      this.lamp.intensity = 0;
      return;
    }
    // Lights: tubes on whenever open; the lamp only while it can be seen.
    const lit = this.open ? 1 : 0;
    const night = clockMinutes < 6.5 * 60 || clockMinutes > 18.5 * 60 ? 1 : 0;
    (this.tubes.material as THREE.MeshStandardMaterial).emissiveIntensity = (1.2 + night * 0.8) * lit;
    this.lamp.intensity = (4 + night * 8) * lit;
    // Fan, drawer, fridge door, diya.
    this.fan.rotation.y += dt * this.fanSpeed * lit;
    this.drawer.position.x = this.drawerHome.x + this.drawerOpen * this.data.interaction.drawerTravel;
    // Contents only draw while the drawer is out (saves ~20 draw calls).
    this.drawerInside.visible = this.drawerOpen > 0.01;
    this.fridgeDoor.rotation.y = this.fridgeOpen * 1.6;
    const fl = 1 + Math.sin(this.time * 23) * 0.12 + Math.sin(this.time * 37) * 0.08;
    this.altarFlame.scale.set(1, fl, 1);
    // Dust motes in the sunbeam (day only).
    const day = clockMinutes > 7 * 60 && clockMinutes < 18 * 60 ? 1 : 0;
    const DW = this.slot.doorWidth;
    const m = new THREE.Matrix4();
    for (let i = 0; i < this.motes.count; i++) {
      const a = this.moteSeeds[i * 3]!;
      const b = this.moteSeeds[i * 3 + 1]!;
      const c = this.moteSeeds[i * 3 + 2]!;
      const t = this.time * (0.05 + c * 0.05);
      const x = (a - 0.5) * DW + Math.sin(t * 3 + a * 9) * 0.1;
      const y = ((b + t * 0.2) % 1) * 2.4 + 0.3;
      const z = -0.3 - c * 1.6 + Math.cos(t * 2 + b * 7) * 0.08;
      m.makeTranslation(x, y, z);
      if (!day) m.makeScale(0, 0, 0);
      this.motes.setMatrixAt(i, m);
    }
    this.motes.instanceMatrix.needsUpdate = true;
  }
}
