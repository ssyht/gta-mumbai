import * as THREE from 'three/webgpu';
import { HumanoidRig, type Outfit } from '../../actors/rig/HumanoidRig';
import * as P from '../../actors/rig/poses';
import { lookAt, solveArm } from '../../actors/rig/ArmIK';
import type { InteriorCell, StockSlot } from '../../world/interiors/InteriorCell';
import { makeBag, makeCoin, makeNewspaper, makeNote, makeNotepad } from '../../world/interiors/ShopPropKit';
import type { InteriorAudio } from '../../audio/InteriorAudio';
import type { ScenarioDirector } from '../scenario/ScenarioDirector';
import type { Subtitles } from '../../ui/Subtitles';
import type { StockItem } from './ShopTransaction';
import { change, Haggle, priceWords, tender } from './ShopTransaction';
import dialogue from '../../data/dialogue/shop.json';

/** Everything C1 needs from the game, kept narrow so the scenario stays testable. */
export interface KiranaHost {
  playerRig: HumanoidRig;
  playerPos: () => THREE.Vector3;
  playerYaw: () => number;
  teleportPlayer: (feet: THREE.Vector3, yaw: number) => void;
  playerOnFoot: () => boolean;
  armed: () => boolean;
  camera: THREE.Camera;
  input: { wasPressed(a: string): boolean; isDown(a: string): boolean };
  money: () => number;
  pay: (amount: number, reason: string) => void;
  heal: (hp: number) => void;
  hint: (text: string | null) => void;
  toast: (text: string) => void;
  clockMinutes: () => number;
  smoke: (at: THREE.Vector3) => void;
}

type Co = Generator<number, void, number>;
type Line = [string, string];
const LINES = dialogue.lines as unknown as Record<string, Line[]>;
const SPEAKERS = dialogue.speakers;
const SC = 'c1-kirana';

const SHAH: Outfit = { skin: 0x9a6b4a, top: 0xf1ede2, bottom: 0x6b5a45, shoes: 0x3b2a1e, hair: 0x9e9e9e };
const AUNTY: Outfit = {
  skin: 0x8a5a3c,
  top: 0xc2185b,
  bottom: 0xc2185b,
  shoes: 0x5d4037,
  hair: 0x1b1b1b,
  drape: 0xd81b60,
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function* wait(sec: number): Co {
  let t = 0;
  while (t < sec) t += yield 0;
}

function* tween(sec: number, fn: (k: number) => void): Co {
  let t = 0;
  fn(0);
  while (t < sec) {
    t += yield 0;
    fn(Math.min(1, t / sec));
  }
}

const ease = (k: number): number => k * k * (3 - 2 * k);

interface IkTarget {
  target: THREE.Vector3;
  w: number;
}

/**
 * SCENARIOS.md C1: walking into Laxmi General Stores and buying something.
 * Mr. Shah reads the paper on his stool, looks up as you approach, greets
 * you, puts the paper down, reads each item's price aloud, tallies on a
 * notepad, checks a ₹500 against the light, opens the galla, counts change
 * coin by coin onto the counter, hip-bumps the drawer shut, bags the goods
 * and hands the bag over. Every object travels in a hand (IK), nothing pops.
 */
export class KiranaScenario {
  readonly shah: HumanoidRig;
  private readonly aunty: HumanoidRig;
  private readonly pose = P.newPose();
  private readonly cur = P.newPose();
  private readonly auntyPose = P.newPose();
  private readonly auntyCur = P.newPose();
  private time = 0;
  private task: Co | null = null;
  private taskWait = 0;
  private handTask: Co | null = null;
  private handWait = 0;
  /** Shopkeeper state for the pose layer. */
  private mode: 'read' | 'stand' | 'phone' | 'walk' | 'hipBump' | 'handsUp' | 'away' = 'read';
  private modeT = 0;
  private lean = 0;
  private readonly ikR: IkTarget = { target: new THREE.Vector3(), w: 0 };
  private readonly ikL: IkTarget = { target: new THREE.Vector3(), w: 0 };
  private readonly look: IkTarget = { target: new THREE.Vector3(), w: 0 };
  private readonly pIkR: IkTarget = { target: new THREE.Vector3(), w: 0 };
  private readonly pIkL: IkTarget = { target: new THREE.Vector3(), w: 0 };
  private pBend = 0;
  private pFaceYaw: number | null = null;
  private readonly sitPos: THREE.Vector3;
  private readonly standPos: THREE.Vector3;
  private readonly newspaper: THREE.Mesh;
  private readonly notepad: THREE.Object3D;
  /** Items in the player's hands (R, L). */
  private held: Array<StockSlot | null> = [null, null];
  private onCounter: StockSlot[] = [];
  private bag: THREE.Object3D | null = null;
  private bagTimer = 0;
  private haggle: Haggle | null = null;
  private haggleHeld = 0;
  private total = 0;
  private stage: 'idle' | 'noticed' | 'greeted' | 'counting' | 'awaitPay' | 'paying' | 'done' = 'idle';
  private eveningLit = -1;
  private wasInside = false;
  private label: HTMLElement | null = null;
  private haggleEl: HTMLElement | null = null;
  private auntyTarget = 0;
  private auntyPos = new THREE.Vector3();
  private auntyAway = 30;
  private auntyPhase = 0;
  /** Debug-run state (window.__game.scenario.run('c1-kirana')). */
  private auto: {
    steps: Array<() => void>;
    ready: Array<() => boolean>;
    i: number;
    timer: number;
    autoplay: boolean;
  } | null = null;
  forcedVariant: 'phone' | 'incense' | 'none' | null = null;
  browsing = false;

  constructor(
    readonly cell: InteriorCell,
    private readonly host: KiranaHost,
    private readonly audio: InteriorAudio,
    private readonly director: ScenarioDirector,
    private readonly subs: Subtitles,
    ui: HTMLElement | null,
  ) {
    const d = cell.data;
    this.shah = new HumanoidRig(SHAH);
    // Spectacles on a chain (Mr. Shah's signature).
    const specMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4, metalness: 0.6 });
    for (const sx of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.004, 4, 12), specMat);
      lens.position.set(sx * 0.035, 0.115, 0.1);
      this.shah.joints.head.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), specMat);
    bridge.position.set(0, 0.118, 0.102);
    this.shah.joints.head.add(bridge);
    this.sitPos = new THREE.Vector3(d.slots.shopkeeper.x, 0, d.slots.shopkeeper.z);
    this.standPos = new THREE.Vector3(d.slots.shopkeeper.x - 0.24, 0, d.slots.shopkeeper.z);
    this.shah.root.position.copy(this.sitPos);
    this.shah.root.rotation.y = d.slots.shopkeeper.yaw;
    cell.group.add(this.shah.root);
    this.newspaper = makeNewspaper();
    this.shah.handR.add(this.newspaper);
    this.newspaper.position.set(0.12, -0.02, 0.06);
    this.newspaper.rotation.set(Math.PI / 2, 0, 0);
    this.notepad = makeNotepad();
    this.notepad.position.copy(cell.notepadSpot);
    cell.group.add(this.notepad);

    this.aunty = new HumanoidRig(AUNTY);
    cell.group.add(this.aunty.root);
    this.aunty.root.visible = false;

    if (ui) {
      this.label = document.createElement('div');
      this.label.id = 'itemlabel';
      ui.appendChild(this.label);
      this.haggleEl = document.createElement('div');
      this.haggleEl.id = 'haggle';
      this.haggleEl.innerHTML = '<span></span><div class="bar"><i></i></div>';
      ui.appendChild(this.haggleEl);
    }

    director.register(SC, {
      run: (opts) => this.debugRun(opts),
      step: () => this.debugStep(),
    });
  }

  // ---- Dialogue ----------------------------------------------------------------

  private say(
    ctx: string,
    vars: Record<string, string> = {},
    who: 'shopkeeper' | 'player' = 'shopkeeper',
  ): number {
    const list = LINES[ctx];
    if (!list?.length) return 0;
    const [hi, en] = list[Math.floor(Math.random() * list.length)]!;
    return this.sayLine(hi, en, who, vars);
  }

  private sayLine(
    hi: string,
    en: string,
    who: 'shopkeeper' | 'player',
    vars: Record<string, string> = {},
  ): number {
    const fill = (s: string): string => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
    const sp = SPEAKERS[who];
    const head = (
      who === 'shopkeeper' ? this.shah.joints.head : this.host.playerRig.joints.head
    ).getWorldPosition(_a);
    const dist = head.distanceTo(this.host.camera.position);
    const dur = this.audio.voice(
      fill(hi),
      dist,
      who === 'shopkeeper' ? { pitch: 0.92, rate: 1 } : { pitch: 1.1, rate: 1.1 },
    );
    this.subs.show(sp.name, sp.color, fill(hi), fill(en), dur + 1.4);
    this.director.beat(SC, `say:${who}`, { hi: fill(hi) });
    return dur;
  }

  // ---- Helpers -------------------------------------------------------------------

  private local(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return this.cell.toLocal(world, out);
  }

  private world(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return this.cell.toWorld(local, out);
  }

  /** Move a world-space IK target smoothly to `to` (world) over `sec`. */
  private *reach(ik: IkTarget, to: () => THREE.Vector3, sec: number, wTo = 1): Co {
    const from = ik.w > 0.01 ? ik.target.clone() : null;
    const w0 = ik.w;
    yield* tween(sec, (k) => {
      const e = ease(k);
      const t = to();
      if (from) ik.target.copy(from).lerp(t, e);
      else ik.target.copy(t);
      ik.w = w0 + (wTo - w0) * e;
    });
  }

  /** Re-parent keeping the world transform, then settle onto `local` over `sec`. */
  private *settle(
    obj: THREE.Object3D,
    parent: THREE.Object3D,
    local: THREE.Vector3,
    sec = 0.1,
    rot?: THREE.Euler,
  ): Co {
    parent.attach(obj);
    const p0 = obj.position.clone();
    const q0 = obj.quaternion.clone();
    const q1 = rot ? new THREE.Quaternion().setFromEuler(rot) : q0.clone();
    yield* tween(sec, (k) => {
      obj.position.copy(p0).lerp(local, k);
      obj.quaternion.copy(q0).slerp(q1, k);
    });
  }

  private grip(obj: THREE.Object3D, hand: THREE.Object3D, sec = 0.08): Co {
    return this.settle(obj, hand, new THREE.Vector3(0, -0.035, 0.02), sec);
  }

  private shahHandWorld(side: 'L' | 'R'): THREE.Vector3 {
    return (side === 'R' ? this.shah.handR : this.shah.handL).getWorldPosition(new THREE.Vector3());
  }

  private playerReachable(target: THREE.Vector3): boolean {
    const p = this.host.playerPos();
    return Math.hypot(target.x - p.x, target.z - p.z) < 1.05;
  }

  private startTask(co: Co): void {
    this.task = co;
    this.taskWait = 0;
  }

  private startHands(co: Co): void {
    this.handTask = co;
    this.handWait = 0;
  }

  private runCo(which: 'task' | 'hand', dt: number): void {
    const co = which === 'task' ? this.task : this.handTask;
    if (!co) return;
    const w = which === 'task' ? this.taskWait : this.handWait;
    if (w > 0) {
      if (which === 'task') this.taskWait -= dt;
      else this.handWait -= dt;
      return;
    }
    const r = co.next(dt);
    if (r.done) {
      if (which === 'task') this.task = null;
      else this.handTask = null;
    } else if (r.value > 0) {
      if (which === 'task') this.taskWait = r.value;
      else this.handWait = r.value;
    }
  }

  get busy(): boolean {
    return !!this.task;
  }

  get handsBusy(): boolean {
    return !!this.handTask;
  }

  // ---- Shopkeeper beats ----------------------------------------------------------

  private *greet(variant: 'phone' | 'incense' | 'none'): Co {
    this.director.beat(SC, 'approach', { variant });
    // Beat 1: looks up from the paper, recognises a customer.
    yield* tween(0.5, (k) => (this.look.w = ease(k)));
    if (variant === 'phone') {
      this.director.beat(SC, 'variant-phone');
      const handset = () =>
        this.cell.handset.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
      yield* tween(0.3, (e) => (this.lean = 0.4 * ease(e)));
      yield* this.reach(this.ikL, handset, 0.4);
      yield* this.settle(this.cell.handset, this.shah.handL, new THREE.Vector3(0, -0.03, 0.03), 0.08);
      yield* tween(0.3, (e) => (this.lean = 0.4 * (1 - ease(e))));
      yield* this.reach(this.ikL, () => this.ikL.target, 0.3, 0);
      this.mode = 'phone';
      this.modeT = 0;
      const d = this.say('phoneWait');
      yield* wait(Math.max(2.6, d + 0.6));
      this.mode = 'read';
      const home = () => this.world(this.cell.handsetHome.clone().add(new THREE.Vector3(0, 0.03, 0)));
      yield* tween(0.3, (e) => (this.lean = 0.4 * ease(e)));
      yield* this.reach(this.ikL, home, 0.45);
      yield* this.settle(
        this.cell.handset,
        this.cell.group,
        this.cell.handsetHome.clone(),
        0.08,
        new THREE.Euler(0, 0, 0),
      );
      yield* this.reach(this.ikL, () => this.ikL.target, 0.3, 0);
      yield* tween(0.3, (e) => (this.lean = 0.4 * (1 - ease(e))));
    }
    // Beat 2 happens when the player crosses the threshold (logged in update()).
    while (!this.cell.inside) yield 0;
    yield* wait(0.5);
    // Beat 3: greeting, newspaper put down on the counter (placed, not hidden).
    const evening = variant === 'incense';
    this.say(evening ? 'eveningGreeting' : 'greeting');
    this.director.beat(SC, 'greeting');
    this.mode = 'stand';
    yield* tween(0.45, (k) => this.shah.root.position.lerpVectors(this.sitPos, this.standPos, ease(k)));
    yield* this.reach(
      this.ikR,
      () => this.world(this.cell.newspaperSpot.clone().add(new THREE.Vector3(0, 0.05, 0))),
      0.45,
    );
    yield* this.settle(
      this.newspaper,
      this.cell.group,
      this.cell.newspaperSpot.clone(),
      0.12,
      new THREE.Euler(0, 0.3, 0),
    );
    this.director.beat(SC, 'newspaper-down');
    yield* this.reach(this.ikR, () => this.ikR.target, 0.3, 0);
    if (evening) yield* this.lightIncense();
    this.stage = 'greeted';
  }

  private *lightIncense(): Co {
    this.director.beat(SC, 'variant-incense');
    const altar = this.cell.altarPoint.clone();
    const spot = new THREE.Vector3(altar.x - 0.35, 0, altar.z + 0.3);
    const start = this.shah.root.position.clone();
    const yaw0 = this.shah.root.rotation.y;
    const yawAltar = Math.atan2(altar.x - spot.x, altar.z - spot.z);
    const turn = (from: number, to: number, k: number): number =>
      from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
    this.mode = 'walk';
    yield* tween(1.0, (k) => {
      this.shah.root.position.lerpVectors(start, spot, ease(k));
      this.shah.root.rotation.y = turn(yaw0, yawAltar, ease(Math.min(1, k * 1.5)));
    });
    this.mode = 'stand';
    yield* this.reach(this.ikR, () => this.world(altar.clone().add(new THREE.Vector3(-0.05, 0.05, 0))), 0.5);
    this.host.smoke(this.world(altar.clone().add(new THREE.Vector3(0, 0.1, 0))));
    this.director.beat(SC, 'incense-lit');
    for (let i = 0; i < 6; i++) {
      this.host.smoke(this.world(altar.clone().add(new THREE.Vector3(0, 0.1, 0))));
      yield* wait(0.25);
    }
    yield* this.reach(this.ikR, () => this.ikR.target, 0.3, 0);
    this.mode = 'walk';
    yield* tween(1.0, (k) => {
      this.shah.root.position.lerpVectors(spot, this.standPos, ease(k));
      this.shah.root.rotation.y = turn(yawAltar, yaw0, ease(Math.min(1, k * 1.5)));
    });
    this.shah.root.rotation.y = yaw0;
    this.mode = 'stand';
  }

  /** Beat 5: pick up each item, turn it to read the price, say it, set it down by him; tally if 2+. */
  private *readPrices(items: StockSlot[]): Co {
    this.stage = 'counting';
    this.lean = 0;
    const ct = this.cell.data.interaction.counterTop;
    let k = 0;
    for (const s of items) {
      const p = () => s.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0));
      const l1 = Math.max(0.3, this.bendFor('R', p(), this.shah));
      yield* tween(0.3, (e) => (this.lean = l1 * ease(e)));
      yield* this.reach(this.ikR, p, 0.4);
      yield* this.grip(s.obj, this.shah.handR);
      // Lift to his face and turn it to read the price.
      const face = () =>
        this.shah.joints.head
          .getWorldPosition(new THREE.Vector3())
          .add(this.forward(0.28))
          .add(new THREE.Vector3(0, -0.12, 0));
      yield* tween(0.3, (e) => (this.lean = l1 * (1 - ease(e))));
      yield* this.reach(this.ikR, face, 0.35);
      yield* tween(0.45, (e) => (s.obj.rotation.y = e * Math.PI));
      this.sayLine(
        `${s.item.name.split(' ')[0]}… ${priceWords(s.item.price)}.`,
        `${s.item.name}, ₹${s.item.price}.`,
        'shopkeeper',
      );
      this.director.beat(SC, 'price-read', { id: s.item.id, price: s.item.price });
      yield* wait(0.5);
      // Set it down on his side of the counter.
      const slot = new THREE.Vector3(
        ct.x0 + (2.5 / ct.rows) * (ct.x1 - ct.x0),
        ct.y + 0.002,
        ct.z0 + ((Math.min(k, 1) + 2.5) / ct.cols) * (ct.z1 - ct.z0),
      );
      k++;
      yield* this.reach(this.ikR, () => this.world(slot.clone().add(new THREE.Vector3(0, 0.04, 0))), 0.4);
      yield* this.settle(s.obj, this.cell.group, slot, 0.08, new THREE.Euler(0, 0, 0));
    }
    yield* this.reach(this.ikR, () => this.ikR.target, 0.25, 0);
    this.total = items.reduce((a, s) => a + s.item.price, 0);
    if (items.length >= 2) {
      // Tally on the notepad: pencil scribbles.
      const pad = () => this.world(this.cell.notepadSpot.clone().add(new THREE.Vector3(0, 0.03, 0)));
      yield* tween(0.25, (e) => (this.lean = 0.25 * ease(e)));
      yield* this.reach(this.ikR, pad, 0.35);
      yield* tween(1.2, (e) =>
        this.ikR.target.copy(pad()).add(new THREE.Vector3(0, 0, Math.sin(e * 40) * 0.02 + (e - 0.5) * 0.04)),
      );
      this.director.beat(SC, 'tally', { items: items.length });
      yield* this.reach(this.ikR, () => this.ikR.target, 0.25, 0);
      yield* tween(0.25, (e) => (this.lean = 0.25 * (1 - ease(e))));
    }
    this.say('total', { total: `₹${this.total}` });
    this.director.beat(SC, 'total', { total: this.total });
    this.haggle = new Haggle(this.total);
    this.stage = 'awaitPay';
  }

  private forward(dist: number): THREE.Vector3 {
    const yaw = this.cell.yawOf(this.shah.root.rotation.y);
    return new THREE.Vector3(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist);
  }

  /** Beats 7–8: payment, counterfeit check, galla, change coin by coin, hip bump, bag + handoff. */
  private *takePayment(notes: THREE.Mesh[], paid: number): Co {
    this.stage = 'paying';
    const cell = this.cell;
    // Take the note(s).
    const lNote = Math.max(
      0.3,
      this.bendFor('R', notes[0]!.getWorldPosition(new THREE.Vector3()), this.shah),
    );
    yield* tween(0.3, (e) => (this.lean = lNote * ease(e)));
    for (const n of notes) {
      yield* this.reach(
        this.ikR,
        () => n.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0)),
        0.35,
      );
      yield* this.grip(n, this.shah.handR);
    }
    yield* tween(0.3, (e) => (this.lean = lNote * (1 - ease(e))));
    if (notes.some((n) => n.userData.denom === 500)) {
      // Hold it up to the tube light.
      this.say('counterfeit');
      const up = () =>
        this.shah.joints.head
          .getWorldPosition(new THREE.Vector3())
          .add(this.forward(0.32))
          .add(new THREE.Vector3(0, 0.06, 0));
      yield* this.reach(this.ikR, up, 0.4);
      yield* tween(0.9, (e) => (notes[0]!.rotation.z = Math.sin(e * Math.PI * 2) * 0.3));
      this.director.beat(SC, 'counterfeit-check');
    }
    // Pass the note(s) to the left hand: the galla is on his left.
    const chest = () =>
      this.shah.joints.spine
        .getWorldPosition(new THREE.Vector3())
        .add(this.forward(0.3))
        .add(new THREE.Vector3(0, 0.22, 0));
    yield* this.reach(this.ikR, chest, 0.35);
    yield* this.reach(this.ikL, () => this.shahHandWorld('R'), 0.3);
    for (const n of notes) yield* this.settle(n, this.shah.handL, new THREE.Vector3(0, -0.035, 0.02), 0.06);
    yield* this.reach(this.ikR, () => this.ikR.target, 0.25, 0);
    // Sidestep toward the galla (it's on his left, under the counter top).
    const byDrawer = this.standPos.clone().add(new THREE.Vector3(0, 0, 0.28));
    yield* tween(0.35, (e) => this.shah.root.position.lerpVectors(this.standPos, byDrawer, ease(e)));
    // Open the galla: left hand to the handle, drawer slides out with a coin rattle.
    yield* this.reach(this.ikL, () => cell.drawerHandle.getWorldPosition(new THREE.Vector3()), 0.4);
    this.audio.clink('drawer', 1.5);
    yield* tween(0.35, (e) => {
      cell.drawerOpen = ease(e);
      this.ikL.target.copy(cell.drawerHandle.getWorldPosition(_b));
    });
    this.director.beat(SC, 'galla-open', { drawerX: cell.drawer.position.x });
    yield* this.reach(this.ikL, () => this.ikL.target, 0.25, 0);
    // Note(s) into the drawer.
    const inside = () =>
      cell.drawerInside.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, -0.05));
    yield* this.reach(this.ikL, inside, 0.35);
    for (const [i, n] of notes.entries())
      yield* this.settle(
        n,
        cell.drawerInside,
        new THREE.Vector3(0.0, 0.015 + i * 0.004, -0.02),
        0.08,
        new THREE.Euler(0, Math.PI / 2, 0),
      );
    // Change, piece by piece, from the drawer to a pile on the counter.
    const ch = change(paid, this.total);
    const pieces: THREE.Object3D[] = [];
    const spot = cell.changeSpot;
    let coinIdx = 0;
    let noteIdx = 0;
    for (const v of [
      ...ch.notes.map((n) => ({ n, coin: false })),
      ...ch.coins.map((n) => ({ n, coin: true })),
    ]) {
      const obj = v.coin ? makeCoin(v.n) : makeNote(v.n);
      obj.position.set((Math.random() - 0.5) * 0.12, 0.012, 0.05 + Math.random() * 0.08);
      cell.drawerInside.add(obj);
      yield* this.reach(
        this.ikL,
        () => obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.02, 0)),
        0.25,
      );
      yield* this.grip(obj, this.shah.handL, 0.06);
      yield* tween(0.2, (e) => (this.lean = 0.65 * ease(e)));
      const dest = v.coin
        ? spot
            .clone()
            .add(
              new THREE.Vector3(
                0.0 + (coinIdx % 2) * 0.006,
                0.0013 + ch.notes.length * 0.003 + coinIdx * 0.0025,
                (coinIdx % 3) * 0.004,
              ),
            )
        : spot.clone().add(new THREE.Vector3(0, 0.0015 + noteIdx * 0.003, 0));
      yield* this.reach(this.ikL, () => this.world(dest.clone().add(new THREE.Vector3(0, 0.025, 0))), 0.3);
      yield* this.settle(obj, cell.group, dest, 0.06, new THREE.Euler(0, Math.random() * 0.5, 0));
      if (v.coin) {
        this.audio.clink('coin', 1.2);
        coinIdx++;
      } else noteIdx++;
      pieces.push(obj);
      yield* tween(0.15, (e) => (this.lean = 0.65 * (1 - ease(e))));
      if (pieces.length >= 9) break; // he rounds off the last few coins as a toffee, like everyone does
    }
    this.director.beat(SC, 'change', { pieces: pieces.length, amount: paid - this.total });
    this.say('change', { change: `₹${paid - this.total}` });
    yield* this.reach(this.ikL, () => this.ikL.target, 0.25, 0);
    // Close the drawer with a hip bump.
    this.mode = 'hipBump';
    this.modeT = 0;
    yield* tween(0.55, (e) => {
      this.modeT = e;
      if (e > 0.35) cell.drawerOpen = Math.max(0, 1 - (e - 0.35) / 0.3);
    });
    cell.drawerOpen = 0;
    this.audio.clink('thump', 1.5);
    this.mode = 'stand';
    yield* tween(0.35, (e) => this.shah.root.position.lerpVectors(byDrawer, this.standPos, ease(e)));
    this.director.beat(SC, 'galla-close');
    // The player scoops the change.
    this.startHands(this.playerScoop(pieces));
    // Beat 8: bag the goods.
    const bag = makeBag();
    bag.position.set(0, 0, 0);
    cell.bagHook.add(bag);
    yield* this.reach(this.ikL, () => cell.bagHook.getWorldPosition(new THREE.Vector3()), 0.35);
    yield* this.settle(bag, this.shah.handL, new THREE.Vector3(0, -0.02, 0.02), 0.08);
    const bagMouth = () => this.shahHandWorld('L').add(new THREE.Vector3(0, -0.06, 0));
    yield* this.reach(this.ikL, () => this.world(new THREE.Vector3(0.95, 1.42, -2.6)), 0.4);
    for (const s of this.onCounter) {
      yield* tween(0.2, (e) => (this.lean = 0.35 * ease(e)));
      yield* this.reach(
        this.ikR,
        () => s.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0)),
        0.3,
      );
      yield* this.grip(s.obj, this.shah.handR, 0.06);
      yield* this.reach(this.ikR, bagMouth, 0.3);
      yield* this.settle(s.obj, bag, new THREE.Vector3(0, -0.18, 0), 0.08);
      s.obj.visible = false;
      yield* tween(0.15, (e) => (this.lean = 0.35 * (1 - ease(e))));
    }
    this.director.beat(SC, 'bag', { items: this.onCounter.length });
    yield* this.reach(this.ikR, () => this.ikR.target, 0.2, 0);
    // Paired handoff: both hands meet over the counter.
    const meet = () => this.world(new THREE.Vector3(0.82, 1.38, -2.6));
    yield* tween(0.3, (e) => (this.lean = 0.5 * ease(e)));
    yield* this.reach(this.ikL, meet, 0.4);
    while (this.handTask) yield 0;
    yield* this.reach(this.pIkL, meet, 0.4);
    yield* wait(0.15);
    this.director.beat(SC, 'handoff-align', {
      gap: +this.shahHandWorld('L')
        .distanceTo(this.host.playerRig.handL.getWorldPosition(new THREE.Vector3()))
        .toFixed(3),
      shahToMeet: +this.shahHandWorld('L').distanceTo(meet()).toFixed(3),
      playerToMeet: +this.host.playerRig.handL
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(meet())
        .toFixed(3),
    });
    yield* this.settle(bag, this.host.playerRig.handL, new THREE.Vector3(0, -0.02, 0.02), 0.08);
    this.bag = bag;
    this.bagTimer = 25;
    this.director.beat(SC, 'handoff');
    yield* this.reach(this.ikL, () => this.ikL.target, 0.3, 0);
    yield* tween(0.3, (e) => (this.lean = 0.5 * (1 - ease(e))));
    yield* this.reach(this.pIkL, () => this.pIkL.target, 0.3, 0);
    for (const s of this.onCounter) {
      if (s.item.heal) this.host.heal(s.item.heal);
    }
    this.onCounter = [];
    this.say('anythingElse');
    this.director.beat(SC, 'anything-else');
    this.stage = 'greeted';
  }

  /** Player scoops the change pile into a pocket. */
  private *playerScoop(pieces: THREE.Object3D[]): Co {
    if (!pieces.length) return;
    const pile = () => pieces[0]!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0));
    yield* tween(0.2, (e) => (this.pBend = 0.35 * ease(e)));
    yield* this.reach(this.pIkR, pile, 0.35);
    for (const o of pieces)
      yield* this.settle(o, this.host.playerRig.handR, new THREE.Vector3(0, -0.03, 0.02), 0.04);
    yield* tween(0.2, (e) => (this.pBend = 0.35 * (1 - ease(e))));
    yield* this.reach(this.pIkR, () => this.pocket(), 0.35);
    for (const o of pieces) o.removeFromParent();
    this.director.beat(SC, 'change-pocketed');
    yield* this.reach(this.pIkR, () => this.pIkR.target, 0.25, 0);
  }

  private pocket(): THREE.Vector3 {
    return this.host.playerRig.joints.hips.localToWorld(new THREE.Vector3(-0.17, -0.08, 0.02));
  }

  // ---- Player hand actions ---------------------------------------------------------

  private *playerPickup(s: StockSlot, hand: 0 | 1): Co {
    const ik = hand === 0 ? this.pIkR : this.pIkL;
    const anchor = hand === 0 ? this.host.playerRig.handR : this.host.playerRig.handL;
    s.taken = true;
    const at = () => s.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
    const pp = this.host.playerPos();
    const t = at();
    this.pFaceYaw = Math.atan2(t.x - pp.x, t.z - pp.z);
    const fridge = this.cell.data.stock.find((d) => d.id === s.item.id)?.level === -1;
    if (fridge) yield* tween(0.3, (e) => (this.cell.fridgeOpen = ease(e)));
    const bend = this.bendFor(hand === 0 ? 'R' : 'L', t);
    yield* tween(0.2, (e) => (this.pBend = bend * ease(e)));
    yield* this.reach(ik, at, 0.3);
    yield* this.grip(s.obj, anchor);
    this.held[hand] = s;
    this.director.beat(SC, 'pickup', { id: s.item.id });
    yield* tween(0.2, (e) => (this.pBend = bend * (1 - ease(e))));
    // Carry it at waist height.
    yield* this.reach(ik, () => this.carryPoint(hand), 0.3, 0.6);
    if (fridge) yield* tween(0.3, (e) => (this.cell.fridgeOpen = 1 - ease(e)));
    this.pFaceYaw = null;
  }

  /**
   * Spine bend that brings a target into arm's reach: the shoulder swings forward and down
   * around the spine joint (0.48 m below it), so bend until the remaining gap fits the arm.
   */
  private bendFor(side: 'L' | 'R', target: THREE.Vector3, rig: HumanoidRig = this.host.playerRig): number {
    rig.root.updateMatrixWorld(true);
    const spine = rig.joints.spine.getWorldPosition(new THREE.Vector3());
    // World-space facing (rigs inside a rotated room have a local yaw only).
    const fwd = rig.root.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const side3 = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(side === 'L' ? 0.2 : -0.2);
    let best = 0;
    for (let b = 0; b <= 0.8; b += 0.05) {
      const sh = spine
        .clone()
        .add(side3)
        .addScaledVector(fwd, Math.sin(b) * 0.48)
        .add(new THREE.Vector3(0, Math.cos(b) * 0.48, 0));
      best = b;
      if (sh.distanceTo(target) < 0.53) break;
    }
    return best;
  }

  private carryPoint(hand: 0 | 1): THREE.Vector3 {
    return this.host.playerRig.joints.hips.localToWorld(
      new THREE.Vector3(hand === 0 ? -0.2 : 0.2, 0.12, 0.3),
    );
  }

  private *playerPlace(): Co {
    const ct = this.cell.data.interaction.counterTop;
    const items: StockSlot[] = [];
    let col = 0;
    for (const hand of [0, 1] as const) {
      const s = this.held[hand];
      if (!s) continue;
      const ik = hand === 0 ? this.pIkR : this.pIkL;
      const slot = new THREE.Vector3(
        ct.x0 + (0.5 / ct.rows) * (ct.x1 - ct.x0),
        ct.y + 0.002,
        ct.z0 + ((col + 1.5) / ct.cols) * (ct.z1 - ct.z0),
      );
      col++;
      yield* tween(0.15, (e) => (this.pBend = 0.3 * ease(e)));
      yield* this.reach(ik, () => this.world(slot.clone().add(new THREE.Vector3(0, 0.05, 0))), 0.35);
      yield* this.settle(s.obj, this.cell.group, slot, 0.08, new THREE.Euler(0, 0, 0));
      this.held[hand] = null;
      items.push(s);
      this.director.beat(SC, 'counter-place', { id: s.item.id });
      yield* this.reach(ik, () => ik.target, 0.25, 0);
      yield* tween(0.15, (e) => (this.pBend = 0.3 * (1 - ease(e))));
    }
    this.onCounter = items;
    this.startTask(this.readPrices(items));
  }

  private *playerPay(amount: number): Co {
    const ct = this.cell.data.interaction.counterTop;
    const notes = tender(amount).map((d) => makeNote(d));
    // Hand to the pocket, out comes the money, onto the counter.
    yield* this.reach(this.pIkR, () => this.pocket(), 0.3);
    for (const n of notes) {
      this.host.playerRig.handR.add(n);
      n.position.set(0, -0.035, 0.02);
    }
    yield* tween(0.15, (e) => (this.pBend = 0.3 * ease(e)));
    const slot = new THREE.Vector3(
      ct.x0 + (0.5 / ct.rows) * (ct.x1 - ct.x0),
      ct.y + 0.002,
      ct.z0 + (2.6 / ct.cols) * (ct.z1 - ct.z0),
    );
    yield* this.reach(this.pIkR, () => this.world(slot.clone().add(new THREE.Vector3(0, 0.04, 0))), 0.4);
    notes.forEach((n, i) => {
      this.cell.group.attach(n);
      n.position.copy(slot).add(new THREE.Vector3(0, i * 0.003, 0));
      n.rotation.set(0, 0.2, 0);
    });
    const paid = notes.reduce((a, n) => a + (n.userData.denom as number), 0);
    this.host.pay(amount, `${this.cell.data.title}`);
    this.director.beat(SC, 'pay', { amount, paid });
    yield* this.reach(this.pIkR, () => this.pIkR.target, 0.25, 0);
    yield* tween(0.15, (e) => (this.pBend = 0.3 * (1 - ease(e))));
    this.startTask(this.takePayment(notes, paid));
  }

  // ---- Frame update -----------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    const cell = this.cell;
    const host = this.host;
    const open = cell.open;
    const pp = host.playerPos();
    const local = this.local(pp);
    const doorDist = Math.hypot(local.x, local.z);
    const inside = cell.inside;

    // Shop closed: Mr. Shah has gone home; the scene resets for tomorrow.
    if (!open) {
      if (this.mode !== 'away') {
        this.mode = 'away';
        this.shah.root.visible = false;
        this.aunty.root.visible = false;
      }
      if (doorDist < 2.5 && local.z > 0)
        host.hint(`${cell.data.title} · closed (opens ${cell.data.hours.open})`);
      return;
    }
    if (this.mode === 'away') {
      this.mode = 'read';
      this.shah.root.visible = true;
      this.shah.root.position.copy(this.sitPos);
    }

    // Beat 1: noticing an approaching customer (within 6 m of the doorway).
    if (this.stage === 'idle' && doorDist < 6 && host.playerOnFoot()) {
      this.stage = 'noticed';
      const evening = host.clockMinutes() >= 18 * 60 && this.eveningLit !== Math.floor(this.time / 86400);
      let variant: 'phone' | 'incense' | 'none' =
        this.forcedVariant ?? (evening ? 'incense' : Math.random() < 0.25 ? 'phone' : 'none');
      if (variant === 'incense') this.eveningLit = Math.floor(this.time / 86400);
      if (host.armed()) {
        this.director.beat(SC, 'armed-at-door');
        variant = 'none';
      }
      this.startTask(this.greet(variant));
    }
    if (inside !== this.wasInside) {
      this.wasInside = inside;
      this.director.beat(SC, inside ? 'threshold' : 'exit-threshold');
      if (!inside && this.stage !== 'idle') this.onExit();
      // Back in after he returned to his paper: a fresh greeting.
      if (inside && this.stage === 'done' && !this.task) {
        this.stage = 'noticed';
        this.startTask(this.greet('none'));
      }
    }
    // Leaving the area resets the visit.
    if (this.stage !== 'idle' && !inside && doorDist > 9 && !this.task) this.resetVisit();

    // Armed: hands up (full robbery is SCENARIOS.md Pack 3).
    if (host.armed() && (inside || doorDist < 4) && this.mode !== 'handsUp') {
      this.mode = 'handsUp';
      this.task = null;
      this.ikR.w = this.ikL.w = 0;
      this.say('armedNotice');
      this.director.beat(SC, 'armed-handsup');
    } else if (!host.armed() && this.mode === 'handsUp') {
      this.mode = 'stand';
    }

    // Pose + IK first, so coroutines that hand objects over see this frame's real hand positions
    // (the player controller resets the arms to FK every frame before we run).
    this.animate(dt);
    if (!this.director.holding) {
      this.runCo('task', dt);
      this.runCo('hand', dt);
    }
    this.updateCustomer(dt);
    this.updatePlayerInput(dt, inside);
    if (this.bag && this.bagTimer > 0) {
      this.bagTimer -= dt;
      if (this.bagTimer <= 0) {
        this.bag.removeFromParent();
        this.bag = null;
      }
    }
    this.debugTick(dt);
  }

  private updatePlayerInput(dt: number, inside: boolean): void {
    const host = this.host;
    this.browsing = inside && !host.armed();
    if (!this.browsing) {
      this.setLabel(null);
      this.setHaggle(null);
      return;
    }
    const busy = this.handsBusy;
    // Beat 4: browsing with the crosshair.
    const cam = host.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const freeHand = this.held[0] ? (this.held[1] ? -1 : 1) : 0;
    let focus: StockSlot | null = null;
    if (freeHand >= 0 && !busy) {
      focus = this.cell.pickStock(cam.position, dir);
      if (focus && !this.playerReachable(focus.obj.getWorldPosition(_a))) focus = null;
    }
    if (focus) this.setLabel(`${focus.item.name} · ${focus.item.dev}`, `₹${focus.item.price}`);
    else this.setLabel(null);
    const front = this.world(
      new THREE.Vector3(
        this.cell.data.interaction.counterFront.x,
        0,
        this.cell.data.interaction.counterFront.z,
      ),
    );
    const atCounter = Math.hypot(front.x - host.playerPos().x, front.z - host.playerPos().z) < 0.8;
    const holding = !!(this.held[0] || this.held[1]);

    let hint: string | null = null;
    if (focus) hint = `E  Pick up ${focus.item.name} (₹${focus.item.price})`;
    else if (atCounter && holding && this.stage === 'greeted' && !this.busy && !busy)
      hint = 'E  Put it on the counter';
    else if (atCounter && this.stage === 'awaitPay' && !this.busy && !busy) {
      const offer = this.haggleOffer();
      hint =
        this.haggleHeld > 0 ? `Release Q to offer ₹${offer}` : `E  Pay ₹${this.total}     Q (hold)  Haggle`;
    } else if (holding && this.stage !== 'counting' && this.stage !== 'paying')
      hint = 'Take it to the counter';
    host.hint(hint);

    if (!busy && host.input.wasPressed('use')) {
      if (focus) this.startHands(this.playerPickup(focus, freeHand as 0 | 1));
      else if (atCounter && holding && this.stage === 'greeted' && !this.busy)
        this.startHands(this.playerPlace());
      else if (atCounter && this.stage === 'awaitPay' && !this.busy) this.tryPay();
    }
    // Beat 6: hold Q to haggle; the offer drops while held, release to make it.
    if (atCounter && this.stage === 'awaitPay' && !this.busy && this.haggle) {
      if (host.input.isDown('radio')) {
        this.haggleHeld += dt;
        this.setHaggle(this.haggleOffer());
      } else if (this.haggleHeld > 0) {
        const offer = this.haggleOffer();
        this.haggleHeld = 0;
        this.setHaggle(null);
        this.sayLine(`Bhaiya, ${priceWords(offer)}?`, `Brother, ₹${offer}?`, 'player');
        const r = this.haggle.offer(offer);
        this.director.beat(SC, `haggle:${r.kind}`, { offer, price: r.price });
        this.startTask(this.haggleReply(r.kind, r.price));
      }
    } else this.setHaggle(null);
  }

  private haggleOffer(): number {
    const k = Math.max(0.35, 1 - this.haggleHeld * 0.22);
    return Math.max(1, Math.round(this.total * k));
  }

  private *haggleReply(kind: 'accept' | 'counter' | 'refuse', price: number): Co {
    yield* wait(1.0);
    if (kind === 'refuse') {
      // Shakes his head.
      this.say(this.haggle?.annoyed ? 'annoyed' : 'haggleRefuse', { price: `₹${price}` });
      yield* tween(0.8, (e) => (this.look.w = 1 - Math.sin(e * Math.PI) * 0.3));
    } else {
      this.say(kind === 'accept' ? 'haggleAccept' : 'haggleCounter', { price: `₹${price}` });
      this.total = price;
    }
  }

  private tryPay(): void {
    if (this.host.money() < this.total) {
      this.sayLine('Paise kam hain, bhai.', "You're short, brother.", 'shopkeeper');
      return;
    }
    this.startHands(this.playerPay(this.total));
  }

  private onExit(): void {
    // Beat 9: he goes back to his newspaper.
    this.director.beat(SC, 'exit');
    if (this.stage === 'greeted' || this.stage === 'noticed') this.startTask(this.backToPaper());
  }

  private *backToPaper(): Co {
    if (this.newspaper.parent !== this.shah.handR) {
      yield* this.reach(
        this.ikR,
        () => this.newspaper.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.03, 0)),
        0.45,
      );
      yield* this.settle(
        this.newspaper,
        this.shah.handR,
        new THREE.Vector3(0.12, -0.02, 0.06),
        0.1,
        new THREE.Euler(Math.PI / 2, 0, 0),
      );
      yield* this.reach(this.ikR, () => this.ikR.target, 0.3, 0);
    }
    yield* tween(0.45, (k) => this.shah.root.position.lerpVectors(this.standPos, this.sitPos, ease(k)));
    this.mode = 'read';
    yield* tween(0.5, (k) => (this.look.w = 1 - ease(k)));
    this.director.beat(SC, 'back-to-paper');
    this.stage = 'done';
  }

  private resetVisit(): void {
    // Items you didn't buy go back on the shelf; bought stock is restocked off-screen.
    for (const s of this.cell.stock) {
      if (s.obj.parent !== s.homeParent || s.taken) {
        s.homeParent.attach(s.obj);
        s.obj.position.copy(s.home);
        s.obj.rotation.set(0, 0, 0);
        s.obj.visible = true;
        s.taken = false;
      }
    }
    this.held = [null, null];
    this.onCounter = [];
    this.stage = 'idle';
    this.haggle = null;
    this.pIkL.w = this.pIkR.w = 0;
    this.handTask = null;
    if (this.newspaper.parent !== this.shah.handR) {
      this.shah.handR.add(this.newspaper);
      this.newspaper.position.set(0.12, -0.02, 0.06);
      this.newspaper.rotation.set(Math.PI / 2, 0, 0);
    }
    this.shah.root.position.copy(this.sitPos);
    this.mode = 'read';
    this.look.w = 0;
  }

  private setLabel(text: string | null, price = ''): void {
    if (!this.label) return;
    if (!text) {
      this.label.classList.remove('on');
      return;
    }
    this.label.innerHTML = `${text}<b>${price}</b>`;
    this.label.classList.add('on');
  }

  private setHaggle(offer: number | null): void {
    if (!this.haggleEl) return;
    if (offer === null) {
      this.haggleEl.classList.remove('on');
      return;
    }
    this.haggleEl.classList.add('on');
    (this.haggleEl.querySelector('span') as HTMLElement).textContent =
      `Your offer: ₹${offer} (asking ₹${this.total})`;
    (this.haggleEl.querySelector('i') as HTMLElement).style.width =
      `${(offer / Math.max(1, this.total)) * 100}%`;
  }

  // ---- Browsing customer (aunty in a saree) ----------------------------------------

  private updateCustomer(dt: number): void {
    const spots = this.cell.data.slots.browse;
    if (!this.aunty.root.visible) {
      this.auntyAway -= dt;
      if (this.auntyAway <= 0 && !this.cell.inside) {
        this.aunty.root.visible = true;
        this.auntyPos.set(0, 0, -0.3);
        this.auntyTarget = 0;
        this.auntyAway = 40 + Math.random() * 40;
      }
      return;
    }
    const tgt =
      this.auntyTarget < spots.length
        ? new THREE.Vector3(spots[this.auntyTarget]!.x, 0, spots[this.auntyTarget]!.z)
        : new THREE.Vector3(0, 0, 0.6);
    const d = tgt.clone().sub(this.auntyPos);
    d.y = 0;
    const dist = d.length();
    let speed = 0;
    if (dist > 0.05) {
      speed = Math.min(1.0, dist * 2);
      this.auntyPos.addScaledVector(d.normalize(), speed * dt);
      this.aunty.root.rotation.y = Math.atan2(d.x, d.z);
    } else {
      this.auntyAway -= dt;
      if (this.auntyAway < 30 - this.auntyTarget * 8) this.auntyTarget++;
      if (this.auntyTarget > spots.length) {
        this.aunty.root.visible = false;
        this.auntyAway = 50 + Math.random() * 60;
      }
    }
    this.aunty.root.position.copy(this.auntyPos);
    this.auntyPhase += dt * speed * 6;
    if (speed > 0.05) P.locomotion(this.auntyPose, this.auntyPhase, speed);
    else P.idle(this.auntyPose, this.time);
    P.blendPose(this.auntyCur, this.auntyPose, 1 - Math.exp(-dt * 10));
    this.aunty.applyPose(this.auntyCur);
  }

  // ---- Animation layer ----------------------------------------------------------------

  private animate(dt: number): void {
    const t = this.time;
    switch (this.mode) {
      case 'read':
        P.seatedRead(this.pose, t);
        break;
      case 'phone':
        this.modeT += dt;
        P.phoneCall(this.pose, t, this.modeT > 0.4);
        break;
      case 'walk':
        P.locomotion(this.pose, t * 7, 1.0);
        break;
      case 'hipBump':
        P.hipBump(this.pose, t, this.modeT);
        break;
      case 'handsUp':
        P.handsUp(this.pose, t, 0.04);
        break;
      default:
        P.standCounter(this.pose, t);
    }
    // Forward lean over the counter.
    this.pose[3] = (this.pose[3] ?? 0) + this.lean;
    P.blendPose(this.cur, this.pose, 1 - Math.exp(-dt * 12));
    this.shah.applyPose(this.cur);
    // Head follows the player while attending.
    if (this.look.w > 0) lookAt(this.shah, this.host.playerRig.joints.head.getWorldPosition(_a), this.look.w);
    if (this.mode !== 'handsUp') {
      const pole = (side: 'L' | 'R'): THREE.Vector3 =>
        this.shah.root.localToWorld(new THREE.Vector3(side === 'L' ? 0.8 : -0.8, 0.6, -0.6));
      if (this.ikR.w > 0) solveArm(this.shah, 'R', this.ikR.target, this.ikR.w, pole('R'));
      if (this.ikL.w > 0) solveArm(this.shah, 'L', this.ikL.target, this.ikL.w, pole('L'));
      else if (this.mode === 'phone') {
        // Handset to the left ear.
        const ear = this.shah.joints.head.localToWorld(new THREE.Vector3(0.1, 0.09, 0.02));
        solveArm(this.shah, 'L', ear, Math.min(1, this.modeT * 3), pole('L'));
      }
    }
    // Player overlays: bend, face the item, arm IK.
    const rig = this.host.playerRig;
    if (this.pFaceYaw !== null) {
      const cy = rig.root.rotation.y;
      const dy = Math.atan2(Math.sin(this.pFaceYaw - cy), Math.cos(this.pFaceYaw - cy));
      rig.root.rotation.y = cy + dy * 0.6;
    }
    if (this.pBend > 0) {
      rig.joints.spine.rotation.x += this.pBend;
      rig.joints.neck.rotation.x -= this.pBend * 0.4;
    }
    // Hold items at the waist between actions.
    for (const hand of [0, 1] as const) {
      const ik = hand === 0 ? this.pIkR : this.pIkL;
      if (this.held[hand] && !this.handTask) {
        ik.target.copy(this.carryPoint(hand));
        ik.w = 0.6;
      }
    }
    if (
      this.bag &&
      this.bag.parent === rig.handL &&
      !this.handTask &&
      this.pIkL.w > 0 &&
      this.stage !== 'paying'
    )
      this.pIkL.w = Math.max(0, this.pIkL.w - dt * 2);
    const pPole = (side: 'L' | 'R'): THREE.Vector3 =>
      rig.root.localToWorld(new THREE.Vector3(side === 'L' ? 0.8 : -0.8, 0.5, -0.5));
    if (this.pIkR.w > 0) solveArm(rig, 'R', this.pIkR.target, this.pIkR.w, pPole('R'));
    if (this.pIkL.w > 0) solveArm(rig, 'L', this.pIkL.target, this.pIkL.w, pPole('L'));
  }

  // ---- Debug driver (screenshots + tests) -------------------------------------------

  private debugRun(opts: Record<string, unknown>): void {
    const variant = (opts.variant as 'phone' | 'incense' | 'none' | undefined) ?? 'none';
    this.forcedVariant = variant;
    const cell = this.cell;
    // Start clean, well away from the shop, so the approach beat fires on step 1.
    this.host.teleportPlayer(this.world(new THREE.Vector3(0, 0.02, 12)), cell.yawOf(Math.PI));
    this.task = null;
    this.resetVisit();
    this.wasInside = false;
    this.mode = 'read';
    const yawIn = cell.yawOf(Math.PI); // facing into the shop (-Z local)
    const tp = (x: number, z: number, yaw: number): void =>
      this.host.teleportPlayer(this.world(new THREE.Vector3(x, 0.02, z)), yaw);
    const pick = (id: string, standX: number, standZ: number): void => {
      const s = cell.stock.find((x) => x.item.id === id)!;
      const sp = s.obj.getWorldPosition(new THREE.Vector3());
      const stand = this.world(new THREE.Vector3(standX, 0.02, standZ));
      this.host.teleportPlayer(stand, Math.atan2(sp.x - stand.x, sp.z - stand.z));
      const hand = this.held[0] ? 1 : 0;
      this.startHands(this.playerPickup(s, hand));
    };
    const front = cell.data.interaction.counterFront;
    const toCounterYaw = cell.yawOf(Math.PI / 2);
    this.auto = {
      i: 0,
      timer: 0,
      autoplay: opts.auto !== false,
      // Each step waits for the scenario to be ready for it (index-aligned with steps).
      ready: [
        () => true,
        () => true,
        () => this.stage === 'greeted' && !this.task,
        () => true,
        () => true,
        () => this.stage === 'greeted' && !this.task,
        () => this.stage === 'awaitPay' && !this.task,
        () => this.stage === 'greeted' && !this.task,
      ],
      steps: [
        () => tp(0, 5, yawIn),
        () => tp(0, -0.8, yawIn),
        () => pick('oil', -0.9, -5.2),
        () => pick('rice', -0.1, -5.2),
        () => {
          tp(front.x, front.z, toCounterYaw);
        },
        () => {
          if (this.stage === 'greeted') this.startHands(this.playerPlace());
        },
        () => {
          if (this.stage === 'awaitPay') this.tryPay();
        },
        () => tp(0, 4, cell.yawOf(0)),
      ],
    };
    this.auto.timer = 0.5;
  }

  /** Durations for each autoplay step (waits for the scenario's own beats). */
  private readonly autoWait = [2.5, 3.0, 2.0, 2.5, 1.0, 9.0, 18.0, 3.0];

  private debugStep(): boolean {
    const a = this.auto;
    if (!a || a.i >= a.steps.length) return false;
    a.steps[a.i]!();
    a.i++;
    a.timer = this.autoWait[a.i - 1] ?? 2;
    return a.i < a.steps.length;
  }

  private debugTick(dt: number): void {
    const a = this.auto;
    if (!a || !a.autoplay) return;
    a.timer -= dt;
    if (a.timer > 0 || this.handTask || !(a.ready[a.i]?.() ?? true)) return;
    if (!this.debugStep()) {
      a.autoplay = false;
      this.forcedVariant = null;
    }
  }

  /** Item ids currently held in the player's hands (tests). */
  get heldIds(): string[] {
    return this.held.filter((s): s is StockSlot => !!s).map((s) => s.item.id);
  }

  get currentStage(): string {
    return this.stage;
  }

  get items(): StockItem[] {
    return this.cell.stock.map((s) => s.item);
  }
}
