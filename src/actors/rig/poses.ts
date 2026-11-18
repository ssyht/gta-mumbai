/**
 * Procedural pose library for the shared greybox rig. A pose is a flat array:
 * [joint euler xyz × 12, bodyY, bodyPitch, bodyRoll]. The animator blends
 * between them, so this file only describes targets.
 *
 * Conventions (rig faces +Z, +X is the character's left):
 *   joint.x < 0 swings a hanging limb forward; knee.x > 0 bends the knee;
 *   elbow.x < 0 bends the forearm forward; shoulderL.z > 0 lifts the left arm out.
 */
export const POSE_JOINTS = [
  'hips',
  'spine',
  'neck',
  'head',
  'shoulderL',
  'elbowL',
  'shoulderR',
  'elbowR',
  'hipL',
  'kneeL',
  'hipR',
  'kneeR',
] as const;
export type JointName = (typeof POSE_JOINTS)[number];
export const POSE_LEN = POSE_JOINTS.length * 3 + 3;
export type Pose = Float32Array;

const IDX: Record<JointName, number> = Object.fromEntries(POSE_JOINTS.map((n, i) => [n, i * 3])) as Record<
  JointName,
  number
>;
const BODY = POSE_JOINTS.length * 3;

export function newPose(): Pose {
  return new Float32Array(POSE_LEN);
}

function set(p: Pose, j: JointName, x = 0, y = 0, z = 0): void {
  const i = IDX[j];
  p[i] = x;
  p[i + 1] = y;
  p[i + 2] = z;
}

function body(p: Pose, y = 0, pitch = 0, roll = 0): void {
  p[BODY] = y;
  p[BODY + 1] = pitch;
  p[BODY + 2] = roll;
}

/** Exponential blend of `cur` toward `target`. */
export function blendPose(cur: Pose, target: Pose, k: number): void {
  for (let i = 0; i < POSE_LEN; i++) cur[i]! += (target[i]! - cur[i]!) * k;
}

export function idle(p: Pose, t: number): Pose {
  p.fill(0);
  const breathe = Math.sin(t * 1.7) * 0.012;
  set(p, 'spine', 0.03 + breathe);
  set(p, 'neck', -0.02 - breathe);
  set(p, 'shoulderL', 0.04, 0, 0.09);
  set(p, 'shoulderR', 0.04, 0, -0.09);
  set(p, 'elbowL', -0.12);
  set(p, 'elbowR', -0.12);
  set(p, 'hips', 0, Math.sin(t * 0.5) * 0.03, Math.sin(t * 0.8) * 0.015);
  set(p, 'kneeL', 0.04);
  set(p, 'kneeR', 0.04);
  return p;
}

/** Walk / jog / sprint cycle. `speed` in m/s, `phase` in radians. */
export function locomotion(p: Pose, phase: number, speed: number): Pose {
  p.fill(0);
  const s = Math.min(1, speed / 6.5);
  const legA = 0.38 + 0.62 * s;
  const kneeA = 0.45 + 0.9 * s;
  const armA = 0.3 + 0.75 * s;
  const sn = Math.sin(phase);
  const cs = Math.cos(phase);
  set(p, 'hipL', -sn * legA);
  set(p, 'hipR', sn * legA);
  set(p, 'kneeL', 0.08 + kneeA * Math.max(0, cs));
  set(p, 'kneeR', 0.08 + kneeA * Math.max(0, -cs));
  set(p, 'shoulderL', sn * armA, 0, 0.1);
  set(p, 'shoulderR', -sn * armA, 0, -0.1);
  set(p, 'elbowL', -(0.2 + 1.1 * s));
  set(p, 'elbowR', -(0.2 + 1.1 * s));
  set(p, 'spine', 0.04 + 0.22 * s, -sn * 0.08 * legA);
  set(p, 'hips', 0, sn * 0.12 * legA);
  set(p, 'neck', -0.15 * s);
  body(p, -Math.abs(Math.cos(phase)) * (0.015 + 0.05 * s) + 0.02 * s);
  return p;
}

export function crouch(p: Pose, phase: number, speed: number): Pose {
  p.fill(0);
  const m = Math.min(1, speed / 1.5);
  const sn = Math.sin(phase) * m;
  set(p, 'hipL', -1.0 - sn * 0.35);
  set(p, 'hipR', -1.0 + sn * 0.35);
  set(p, 'kneeL', 1.7 + Math.max(0, Math.cos(phase)) * 0.3 * m);
  set(p, 'kneeR', 1.7 + Math.max(0, -Math.cos(phase)) * 0.3 * m);
  set(p, 'spine', 0.45);
  set(p, 'neck', -0.35);
  set(p, 'shoulderL', -0.5 + sn * 0.3, 0, 0.15);
  set(p, 'shoulderR', -0.5 - sn * 0.3, 0, -0.15);
  set(p, 'elbowL', -0.9);
  set(p, 'elbowR', -0.9);
  body(p, -0.36);
  return p;
}

export function airborne(p: Pose, rising: boolean, t: number): Pose {
  p.fill(0);
  if (rising) {
    set(p, 'hipL', -0.75);
    set(p, 'kneeL', 1.1);
    set(p, 'hipR', 0.15);
    set(p, 'kneeR', 0.6);
    set(p, 'shoulderL', -0.4, 0, 0.5);
    set(p, 'shoulderR', 0.5, 0, -0.5);
  } else {
    const w = Math.sin(t * 9) * 0.15;
    set(p, 'hipL', -0.35);
    set(p, 'kneeL', 0.5);
    set(p, 'hipR', 0.1);
    set(p, 'kneeR', 0.35);
    set(p, 'shoulderL', -0.2 + w, 0, 0.9);
    set(p, 'shoulderR', -0.2 - w, 0, -0.9);
  }
  set(p, 'elbowL', -0.5);
  set(p, 'elbowR', -0.5);
  set(p, 'spine', 0.1);
  return p;
}

export function vault(p: Pose, t01: number): Pose {
  p.fill(0);
  const k = Math.sin(t01 * Math.PI);
  set(p, 'spine', 0.35 * k);
  set(p, 'shoulderL', -1.3 * k, 0, 0.25);
  set(p, 'elbowL', -0.1);
  set(p, 'shoulderR', -0.6 * k, 0, -0.9 * k);
  set(p, 'hipL', -1.3 * k, 0, 0.5 * k);
  set(p, 'kneeL', 1.5 * k);
  set(p, 'hipR', -1.2 * k, 0, 0.4 * k);
  set(p, 'kneeR', 1.4 * k);
  body(p, 0, 0, -0.35 * k);
  return p;
}

export function climb(p: Pose, t01: number): Pose {
  p.fill(0);
  const reach = 1 - t01;
  set(p, 'shoulderL', -2.6 * reach - 0.3, 0, 0.2);
  set(p, 'shoulderR', -2.6 * reach - 0.3, 0, -0.2);
  set(p, 'elbowL', -0.4 - 1.2 * t01);
  set(p, 'elbowR', -0.4 - 1.2 * t01);
  set(p, 'hipL', -1.2 * t01);
  set(p, 'kneeL', 1.6 * t01);
  set(p, 'hipR', -0.3);
  set(p, 'kneeR', 0.5);
  set(p, 'spine', 0.35 * t01);
  return p;
}

/** Seated with hands on the wheel / handlebar. */
export function drive(p: Pose, steer: number, t: number): Pose {
  p.fill(0);
  set(p, 'hipL', -1.45, 0, 0.06);
  set(p, 'hipR', -1.45, 0, -0.06);
  set(p, 'kneeL', 1.3);
  set(p, 'kneeR', 1.3);
  set(p, 'spine', -0.06, steer * 0.12);
  set(p, 'neck', 0.04, steer * 0.25);
  set(p, 'shoulderL', -0.95 + steer * 0.25, 0, 0.18);
  set(p, 'shoulderR', -0.95 - steer * 0.25, 0, -0.18);
  set(p, 'elbowL', -0.75);
  set(p, 'elbowR', -0.75);
  body(p, Math.sin(t * 7) * 0.002);
  return p;
}

export function sit(p: Pose, t: number): Pose {
  p.fill(0);
  set(p, 'hipL', -1.5, 0, 0.08);
  set(p, 'hipR', -1.5, 0, -0.08);
  set(p, 'kneeL', 1.45);
  set(p, 'kneeR', 1.45);
  set(p, 'spine', -0.04 + Math.sin(t * 1.5) * 0.01);
  set(p, 'shoulderL', -0.3, 0, 0.12);
  set(p, 'shoulderR', -0.3, 0, -0.12);
  set(p, 'elbowL', -1.0);
  set(p, 'elbowR', -1.0);
  return p;
}

/** Scooter / motorbike rider. */
export function ride(p: Pose, steer: number): Pose {
  p.fill(0);
  set(p, 'hipL', -1.15, 0, 0.12);
  set(p, 'hipR', -1.15, 0, -0.12);
  set(p, 'kneeL', 1.35);
  set(p, 'kneeR', 1.35);
  set(p, 'spine', 0.14, steer * 0.15);
  set(p, 'shoulderL', -0.9 + steer * 0.2, 0, 0.22);
  set(p, 'shoulderR', -0.9 - steer * 0.2, 0, -0.22);
  set(p, 'elbowL', -0.45);
  set(p, 'elbowR', -0.45);
  return p;
}

export function pillion(p: Pose, t: number): Pose {
  p.fill(0);
  set(p, 'hipL', -1.05, 0, 0.32);
  set(p, 'hipR', -1.05, 0, -0.32);
  set(p, 'kneeL', 1.6);
  set(p, 'kneeR', 1.6);
  set(p, 'spine', 0.05);
  set(p, 'neck', 0, Math.sin(t * 0.4) * 0.4);
  set(p, 'shoulderL', -0.5, 0, 0.3);
  set(p, 'shoulderR', -0.5, 0, -0.3);
  set(p, 'elbowL', -0.7);
  set(p, 'elbowR', -0.7);
  return p;
}

/** Standing in a moving bus, one hand on the overhead rail; sways with the ride. */
export function standHoldRail(p: Pose, t: number, sway: number): Pose {
  p.fill(0);
  set(p, 'shoulderR', -2.85, 0, -0.12);
  set(p, 'elbowR', -0.25);
  set(p, 'shoulderL', 0.05, 0, 0.1);
  set(p, 'elbowL', -0.3);
  set(p, 'hipL', -0.05, 0, 0.08);
  set(p, 'hipR', 0.05, 0, -0.08);
  set(p, 'kneeL', 0.08);
  set(p, 'kneeR', 0.08);
  set(p, 'spine', 0.02, 0, sway * 0.3);
  set(p, 'neck', 0, Math.sin(t * 0.3) * 0.3);
  body(p, 0, 0, Math.sin(t * 1.3) * 0.02 + sway * 0.12);
  return p;
}

/**
 * Hanging off the open bus door, Mumbai-style: right hand on the door rail,
 * body leaning out to the left, left leg dangling, left arm free.
 */
export function doorHang(p: Pose, t: number, speed: number): Pose {
  p.fill(0);
  const wind = Math.min(1, speed / 12);
  set(p, 'shoulderR', -2.3, 0, 0.35);
  set(p, 'elbowR', -0.35);
  set(p, 'shoulderL', -0.3 + Math.sin(t * 2.2) * 0.25 * wind, 0, 1.0 + 0.3 * wind);
  set(p, 'elbowL', -0.3);
  set(p, 'hipL', -0.25 + Math.sin(t * 3.1) * 0.15 * wind, 0, 0.55);
  set(p, 'kneeL', 0.35);
  set(p, 'hipR', 0.05, 0, -0.05);
  set(p, 'kneeR', 0.1);
  set(p, 'spine', 0.05, 0.25, 0.1);
  set(p, 'neck', 0, 0.5);
  body(p, 0, 0, 0.32 + 0.08 * wind);
  return p;
}

/** Flailing tumble while ragdolled / thrown. */
export function tumble(p: Pose, t: number): Pose {
  p.fill(0);
  set(p, 'shoulderL', Math.sin(t * 11) * 1.2 - 0.5, 0, 0.9 + Math.sin(t * 7) * 0.5);
  set(p, 'shoulderR', Math.cos(t * 9) * 1.2 - 0.5, 0, -0.9 - Math.cos(t * 6) * 0.5);
  set(p, 'elbowL', -0.8 + Math.sin(t * 13) * 0.4);
  set(p, 'elbowR', -0.8 + Math.cos(t * 12) * 0.4);
  set(p, 'hipL', Math.sin(t * 8) * 0.8 - 0.3, 0, 0.3);
  set(p, 'hipR', Math.cos(t * 10) * 0.8 - 0.3, 0, -0.3);
  set(p, 'kneeL', 0.8 + Math.sin(t * 9) * 0.4);
  set(p, 'kneeR', 0.8 + Math.cos(t * 11) * 0.4);
  set(p, 'spine', 0.3);
  return p;
}

/** Lying on the ground, dazed (before getting up). */
export function lying(p: Pose): Pose {
  p.fill(0);
  set(p, 'shoulderL', -0.4, 0, 1.2);
  set(p, 'shoulderR', -0.2, 0, -1.0);
  set(p, 'hipL', -0.3, 0, 0.25);
  set(p, 'kneeL', 0.6);
  set(p, 'hipR', 0.05, 0, -0.1);
  set(p, 'kneeR', 0.1);
  // Pitch the whole body onto its back around the feet, lifted by body thickness.
  body(p, 0.12, -Math.PI / 2, 0);
  return p;
}

/** Reaching forward to yank a driver out (carjack) or grab a door. */
export function reach(p: Pose): Pose {
  p.fill(0);
  set(p, 'shoulderL', -1.45, 0, 0.1);
  set(p, 'shoulderR', -1.45, 0, -0.1);
  set(p, 'elbowL', -0.25);
  set(p, 'elbowR', -0.25);
  set(p, 'spine', 0.2);
  set(p, 'hipL', -0.35);
  set(p, 'kneeL', 0.4);
  return p;
}

/** Angry NPC shaking a fist after being carjacked. */
export function shakeFist(p: Pose, t: number): Pose {
  idle(p, t);
  set(p, 'shoulderR', -2.5, 0, -0.25);
  set(p, 'elbowR', -1.2 + Math.sin(t * 14) * 0.35);
  set(p, 'neck', -0.15);
  return p;
}
