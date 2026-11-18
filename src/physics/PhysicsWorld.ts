import RAPIER from '@dimforge/rapier3d-compat';
import { Groups } from './layers';

export type Rapier = typeof RAPIER;
export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Q4 extends V3 {
  w: number;
}

export interface RayHit {
  distance: number;
  point: V3;
  normal: V3;
  collider: RAPIER.Collider;
}

let initPromise: Promise<void> | null = null;

/** Initialise the Rapier WASM module once (silences its init deprecation notice). */
export function initRapier(): Promise<void> {
  if (!initPromise) {
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('deprecated parameters')) return;
      warn(...args);
    };
    initPromise = RAPIER.init().finally(() => {
      console.warn = warn;
    });
  }
  return initPromise;
}

/** Thin wrapper over a Rapier world: fixed stepping, static helpers, queries. */
export class PhysicsWorld {
  readonly R: Rapier = RAPIER;
  readonly world: RAPIER.World;
  readonly ground: RAPIER.RigidBody;
  lastStepMs = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  static async create(): Promise<PhysicsWorld> {
    await initRapier();
    return new PhysicsWorld();
  }

  step(dt: number): void {
    const t0 = performance.now();
    this.world.timestep = dt;
    this.world.step();
    this.lastStepMs = performance.now() - t0;
  }

  addStaticBox(center: V3, half: V3, rotation?: Q4, friction = 0.9): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction)
      .setCollisionGroups(Groups.STATIC);
    if (rotation) desc.setRotation(rotation);
    return this.world.createCollider(desc, this.ground);
  }

  addStaticCylinder(center: V3, halfHeight: number, radius: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(center.x, center.y, center.z)
      .setCollisionGroups(Groups.STATIC);
    return this.world.createCollider(desc, this.ground);
  }

  castRay(
    origin: V3,
    dir: V3,
    maxDist: number,
    filterGroups: number,
    excludeBody?: RAPIER.RigidBody,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filterGroups,
      undefined,
      excludeBody,
    );
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      distance: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      collider: hit.collider,
    };
  }

  /** Height of the static ground under (x, z), or `fallback` if nothing is hit. */
  groundHeight(x: number, z: number, fromY = 50, fallback = 0): number {
    const hit = this.castRay({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, fromY + 50, Groups.GROUND_QUERY);
    return hit ? hit.point.y : fallback;
  }

  /** True if a capsule standing at `feet` would overlap static geometry or vehicles. */
  capsuleBlocked(feet: V3, radius = 0.3, halfHeight = 0.55, excludeBody?: RAPIER.RigidBody): boolean {
    const shape = new RAPIER.Capsule(halfHeight, radius);
    const pos = { x: feet.x, y: feet.y + halfHeight + radius + 0.05, z: feet.z };
    const hit = this.world.intersectionWithShape(
      pos,
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      Groups.PLAYER_QUERY,
      undefined,
      excludeBody,
    );
    return hit !== null;
  }
}
