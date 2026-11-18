/**
 * Rapier collision layers. An interaction group is 32 bits:
 * upper 16 = memberships, lower 16 = filter. Two colliders interact only if
 * each one's membership is in the other's filter.
 */
export const Layer = {
  STATIC: 1 << 0,
  VEHICLE: 1 << 1,
  PLAYER: 1 << 2,
  RAGDOLL: 1 << 3,
  NPC: 1 << 4,
  ALL: 0xffff,
} as const;

export function groups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
}

export const Groups = {
  STATIC: groups(Layer.STATIC, Layer.ALL),
  /** Vehicles collide with the world, each other, ragdolls; the player only via queries. */
  VEHICLE_CHASSIS: groups(
    Layer.VEHICLE,
    Layer.STATIC | Layer.VEHICLE | Layer.PLAYER | Layer.RAGDOLL | Layer.NPC,
  ),
  /**
   * The kinematic player body makes no contacts with vehicles, so a car hitting
   * the player isn't stopped dead by an infinite-mass wall; hits are resolved
   * by gameplay (ragdoll) instead.
   */
  PLAYER_BODY: groups(Layer.PLAYER, Layer.STATIC),
  /** Character-controller sweeps still treat vehicles as solid. */
  PLAYER_QUERY: groups(Layer.PLAYER, Layer.STATIC | Layer.VEHICLE),
  RAGDOLL: groups(Layer.RAGDOLL, Layer.STATIC | Layer.VEHICLE | Layer.RAGDOLL),
  /** Wheel rays ride on the world and other vehicles, never on people. */
  WHEEL_QUERY: groups(Layer.VEHICLE, Layer.STATIC | Layer.VEHICLE),
  CAMERA_QUERY: groups(Layer.ALL, Layer.STATIC | Layer.VEHICLE),
  GROUND_QUERY: groups(Layer.ALL, Layer.STATIC),
} as const;
