import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HumanoidRig } from '../../actors/rig/HumanoidRig';
import { newPose } from '../../actors/rig/poses';
import { InteriorCell, type InteriorData } from '../../world/interiors/InteriorCell';
import type { InteriorSlot } from '../../world/buildings/StreetBuildings';
import type { PhysicsWorld } from '../../physics/PhysicsWorld';
import type { InteriorAudio } from '../../audio/InteriorAudio';
import type { Subtitles } from '../../ui/Subtitles';
import { ScenarioDirector } from '../scenario/ScenarioDirector';
import { KiranaScenario } from './KiranaScenario';
import laxmi from '../../data/interiors/laxmi-general.json';

/**
 * SCENARIOS.md Part E acceptance tests for C1 (walk in and buy), run headless
 * through the scenario's own debug driver: beat order, the galla drawer joint
 * actually moving, change coins existing as real objects on the counter,
 * items travelling in the hand, and nothing floating above the counter.
 */
function setup(variant: 'none' | 'phone' | 'incense', clock = 11 * 60 + 30) {
  const scene = new THREE.Scene();
  const physics = {
    addStaticBox: () => ({ setEnabled: () => {} }),
    addStaticCylinder: () => ({}),
  } as unknown as PhysicsWorld;
  const slot: InteriorSlot = {
    id: 'laxmi-general',
    name: 'LAXMI GENERAL STORES',
    frame: new THREE.Matrix4().makeTranslation(17, 0.18, -9.5),
    doorWidth: 3.0,
    roomW: 4.2,
    roomD: 6,
    roomH: 3.3,
    floorY: 0.18,
  };
  const data = laxmi as unknown as InteriorData;
  const cell = new InteriorCell(scene, physics, slot, data);
  const rig = new HumanoidRig(
    { skin: 0x8d5524, top: 0x2bb3a0, bottom: 0x2f4fa8, shoes: 0xffffff, hair: 0x111111 },
    true,
  );
  scene.add(rig.root);
  const pos = new THREE.Vector3(17, 0.2, 5);
  let yaw = 0;
  let money = 5000;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const audio = { voice: () => 0.6, clink: () => {} } as unknown as InteriorAudio;
  const subs = { show: () => {}, update: () => {} } as unknown as Subtitles;
  const director = new ScenarioDirector();
  const k = new KiranaScenario(
    cell,
    {
      playerRig: rig,
      playerPos: () => pos,
      playerYaw: () => yaw,
      teleportPlayer: (feet, y) => {
        pos.copy(feet);
        yaw = y;
      },
      playerOnFoot: () => true,
      armed: () => false,
      camera,
      input: { wasPressed: () => false, isDown: () => false },
      money: () => money,
      pay: (a) => (money -= a),
      heal: () => {},
      hint: () => {},
      toast: () => {},
      clockMinutes: () => clock,
      smoke: () => {},
    },
    audio,
    director,
    subs,
    null,
  );
  director.run('c1-kirana', { variant, auto: true });
  const step = (dt: number): void => {
    director.tick(dt);
    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    rig.applyPose(newPose());
    camera.position.copy(pos).add(new THREE.Vector3(0, 1.6, 2));
    camera.lookAt(pos);
    camera.updateMatrixWorld();
    cell.update(dt, camera, pos, clock, 3);
    k.update(dt);
    scene.updateMatrixWorld(true);
  };
  return { scene, cell, rig, k, director, step, getMoney: () => money };
}

const ORDER = [
  'approach',
  'threshold',
  'greeting',
  'newspaper-down',
  'pickup',
  'pickup',
  'counter-place',
  'counter-place',
  'price-read',
  'price-read',
  'tally',
  'total',
  'pay',
  'counterfeit-check',
  'galla-open',
  'change',
  'galla-close',
  'change-pocketed',
  'bag',
  'handoff',
  'anything-else',
  'exit',
];

describe('C1 Kirana: walk in and buy (SCENARIOS.md E)', () => {
  it('plays every beat in order with physical truth for drawer, cash, coins and items', () => {
    const { cell, rig, k, director, step, getMoney } = setup('none');
    const ct = cell.data.interaction.counterTop;
    let drawerMax = 0;
    let drawerMaxX = -Infinity;
    const drawerHomeX = cell.drawer.position.x;
    let maxHandGap = 0;
    let paperGap = 0;
    let handoffGap = 1;
    let coinsOnCounter = 0;
    let pickupInHand = 0;
    let counterRestError = 0;
    const hands = new Set<THREE.Object3D>([rig.handL, rig.handR, k.shah.handL, k.shah.handR]);
    const w = new THREE.Vector3();
    const hw = new THREE.Vector3();
    director.onBeat = (e) => {
      if (e.beat === 'handoff-align') handoffGap = Number(e.data?.gap ?? 1);
      if (e.beat === 'pickup') {
        const s = cell.stock.find((x) => x.item.id === e.data?.id);
        if (s && (s.obj.parent === rig.handR || s.obj.parent === rig.handL)) pickupInHand++;
      }
      if (e.beat === 'change')
        coinsOnCounter = cell.group.children.filter((o) => o.userData.kind === 'coin').length;
      if (e.beat === 'total') {
        for (const s of cell.stock)
          if (s.obj.parent === cell.group && s.taken) {
            s.obj.getWorldPosition(w);
            counterRestError = Math.max(counterRestError, Math.abs(w.y - (0.18 + ct.y + 0.002)));
          }
      }
    };
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 90 && !director.beats('c1-kirana').includes('exit'); i++) {
      step(dt);
      drawerMax = Math.max(drawerMax, cell.drawerOpen);
      drawerMaxX = Math.max(drawerMaxX, cell.drawer.position.x);
      // Anything held must ride the hand (no floating carry).
      for (const h of hands) {
        h.getWorldPosition(hw);
        for (const c of h.children) {
          c.getWorldPosition(w);
          const g = w.distanceTo(hw);
          if (c.userData.kind === 'newspaper') {
            paperGap = Math.max(paperGap, g);
            continue;
          }
          if (g > maxHandGap) {
            maxHandGap = g;
            (globalThis as Record<string, unknown>).__worst =
              `${h.name}:${c.userData.kind ?? c.type}:${g.toFixed(3)} after ${director.beats('c1-kirana').slice(-2).join('>')}`;
          }
        }
      }
    }
    const beats = director.beats('c1-kirana').filter((b) => !b.startsWith('say:') && b !== 'exit-threshold');
    // Required beats appear in this order (others may interleave).
    let at = -1;
    for (const b of ORDER) {
      const idx = beats.indexOf(b, at + 1);
      expect(idx, `beat ${b} after index ${at} in ${beats.join(',')}`).toBeGreaterThan(at);
      at = idx;
    }
    expect(drawerMax).toBeCloseTo(1, 2);
    expect(drawerMaxX - drawerHomeX).toBeCloseTo(cell.data.interaction.drawerTravel, 3);
    expect(cell.drawerOpen).toBe(0);
    expect(coinsOnCounter).toBeGreaterThanOrEqual(1);
    expect(pickupInHand).toBe(2);
    expect(counterRestError).toBeLessThan(0.01);
    // Objects ride the palm: the grip puts the object's pivot 4 cm off the palm centre.
    expect(maxHandGap, String((globalThis as Record<string, unknown>).__worst)).toBeLessThan(0.05);
    // The newspaper is held by its edge (14 cm offset by design).
    expect(paperGap).toBeLessThan(0.15);
    // Paired handoff: both hands at the same point when the bag changes hands.
    expect(handoffGap).toBeLessThan(0.02);
    expect(getMoney()).toBe(5000 - 254);
  });

  it('phone variant: he takes the handset off its base and puts it back', () => {
    const { cell, k, director, step } = setup('phone');
    let inHand = false;
    for (let i = 0; i < 60 * 12; i++) {
      step(1 / 60);
      if (cell.handset.parent === k.shah.handL) inHand = true;
      if (director.beats('c1-kirana').includes('greeting')) break;
    }
    expect(director.beats('c1-kirana')).toContain('variant-phone');
    expect(inHand).toBe(true);
    expect(cell.handset.parent).toBe(cell.group);
    expect(cell.handset.position.distanceTo(cell.handsetHome)).toBeLessThan(0.001);
  });

  it('evening variant: incense at the altar before serving', () => {
    const { director, step } = setup('incense', 19 * 60 + 10);
    for (let i = 0; i < 60 * 15 && !director.beats('c1-kirana').includes('pickup'); i++) step(1 / 60);
    const b = director.beats('c1-kirana');
    expect(b.indexOf('incense-lit')).toBeGreaterThan(b.indexOf('newspaper-down'));
  });
});
