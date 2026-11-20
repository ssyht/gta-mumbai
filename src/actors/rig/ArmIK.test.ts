import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { HumanoidRig } from './HumanoidRig';
import { newPose } from './poses';
import { solveArm } from './ArmIK';

const OUTFIT = { skin: 0x8d5524, top: 0xffffff, bottom: 0x223344, shoes: 0x111111, hair: 0x111111 };

describe('ArmIK', () => {
  it('puts the palm within 1 cm of reachable targets, both arms, rotated rig', () => {
    const rig = new HumanoidRig(OUTFIT, true);
    rig.root.position.set(3, 0.2, -2);
    rig.root.rotation.y = 0.7;
    rig.applyPose(newPose());
    rig.root.updateMatrixWorld(true);
    const hand = new THREE.Vector3();
    const targets = [
      new THREE.Vector3(0.3, 1.05, 0.3),
      new THREE.Vector3(-0.3, 1.25, 0.4),
      new THREE.Vector3(0.1, 1.05, 0.35),
      new THREE.Vector3(0.2, 1.7, 0.25),
    ];
    for (const side of ['L', 'R'] as const) {
      for (const local of targets) {
        const t = rig.root.localToWorld(
          local.clone().setX(side === 'L' ? Math.abs(local.x) : -Math.abs(local.x)),
        );
        rig.applyPose(newPose());
        solveArm(rig, side, t);
        rig.root.updateMatrixWorld(true);
        (side === 'L' ? rig.handL : rig.handR).getWorldPosition(hand);
        expect(hand.distanceTo(t), `${side} ${local.toArray()}`).toBeLessThan(0.01);
      }
    }
  });
  it('clamps unreachable targets to a straight arm pointing at them', () => {
    const rig = new HumanoidRig(OUTFIT, true);
    rig.applyPose(newPose());
    const far = new THREE.Vector3(0, 1.3, 3);
    solveArm(rig, 'R', far);
    rig.root.updateMatrixWorld(true);
    const s = rig.joints.shoulderR.getWorldPosition(new THREE.Vector3());
    const h = rig.handR.getWorldPosition(new THREE.Vector3());
    expect(h.distanceTo(s)).toBeGreaterThan(0.55);
    const toT = far.clone().sub(s).normalize();
    expect(h.clone().sub(s).normalize().dot(toT)).toBeGreaterThan(0.999);
  });
});
