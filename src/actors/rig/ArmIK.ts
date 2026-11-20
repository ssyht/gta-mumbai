import * as THREE from 'three/webgpu';
import { ARM, type HumanoidRig } from './HumanoidRig';

const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _qe = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

/**
 * Analytic two-bone arm IK (SCENARIOS.md A4) on top of the FK pose: the hand
 * (palm centre) reaches a world-space target, the elbow points toward a pole
 * (down, back and out by default). `weight` blends from the FK pose, so a
 * reach eases in and out. Call after `rig.applyPose()` each frame.
 */
export function solveArm(
  rig: HumanoidRig,
  side: 'L' | 'R',
  target: THREE.Vector3,
  weight = 1,
  pole?: THREE.Vector3,
): void {
  if (weight <= 0) return;
  const shoulder = side === 'L' ? rig.joints.shoulderL : rig.joints.shoulderR;
  const elbow = side === 'L' ? rig.joints.elbowL : rig.joints.elbowR;
  const parent = shoulder.parent!;
  rig.root.updateMatrixWorld(true);
  _inv.copy(parent.matrixWorld).invert();
  // Target and pole in the shoulder's parent space, relative to the shoulder.
  _t.copy(target).applyMatrix4(_inv).sub(shoulder.position);
  if (pole) _pole.copy(pole).applyMatrix4(_inv).sub(shoulder.position);
  else _pole.set(side === 'L' ? 0.6 : -0.6, -1, -0.5);
  const L1 = ARM.upper;
  const L2 = ARM.lower;
  const d = THREE.MathUtils.clamp(_t.length(), 0.08, L1 + L2 - 1e-4);
  _dir.copy(_t).normalize();
  // Bend plane normal; fall back if the pole is collinear with the reach.
  _n.crossVectors(_dir, _pole);
  if (_n.lengthSq() < 1e-8) _n.crossVectors(_dir, AX_X);
  _n.normalize();
  const a1 = Math.acos(THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const cosE = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
  const bend = Math.PI - Math.acos(cosE);
  // Upper-arm direction: the reach direction swung toward the pole by a1.
  _u.copy(_dir).applyAxisAngle(_n, a1);
  _q1.setFromUnitVectors(DOWN, _u);
  // Twist so the forearm folds (about local X, toward local +Z) onto the target.
  _w.copy(_dir).addScaledVector(_u, -_u.dot(_dir));
  if (_w.lengthSq() > 1e-10) {
    _w.normalize();
    _x.copy(AX_Z).applyQuaternion(_q1);
    const ang = Math.atan2(_u.dot(_x.clone().cross(_w)), _x.dot(_w));
    _qt.setFromAxisAngle(_u, ang);
    _qs.multiplyQuaternions(_qt, _q1);
  } else _qs.copy(_q1);
  _qe.setFromAxisAngle(AX_X, -bend);
  if (weight >= 1) {
    shoulder.quaternion.copy(_qs);
    elbow.quaternion.copy(_qe);
  } else {
    shoulder.quaternion.slerp(_qs, weight);
    elbow.quaternion.slerp(_qe, weight);
  }
  shoulder.updateMatrixWorld(true);
}

/** Turn the head toward a world point (yaw/pitch limited), blended over the FK pose. */
export function lookAt(rig: HumanoidRig, target: THREE.Vector3, weight = 1, maxYaw = 1.2): void {
  if (weight <= 0) return;
  const head = rig.joints.head;
  const neck = rig.joints.neck;
  rig.root.updateMatrixWorld(true);
  _inv.copy(neck.matrixWorld).invert();
  _t.copy(target).applyMatrix4(_inv).sub(head.position);
  const yaw = THREE.MathUtils.clamp(Math.atan2(_t.x, _t.z), -maxYaw, maxYaw);
  const pitch = THREE.MathUtils.clamp(-Math.atan2(_t.y, Math.hypot(_t.x, _t.z)), -0.6, 0.6);
  _qs.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  head.quaternion.slerp(_qs, weight);
  head.updateMatrixWorld(true);
}
