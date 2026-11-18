/**
 * Fixed-timestep accumulator. Physics and gameplay run at a fixed rate,
 * rendering interpolates between the last two steps with `alpha`.
 */
export class FixedStepClock {
  readonly step: number;
  private accumulator = 0;
  private readonly maxSteps: number;

  constructor(hz = 60, maxStepsPerFrame = 5) {
    this.step = 1 / hz;
    this.maxSteps = maxStepsPerFrame;
  }

  /** Feed real frame time; returns how many fixed steps to run this frame. */
  advance(frameDt: number): number {
    this.accumulator += Math.max(0, frameDt);
    let steps = Math.floor(this.accumulator / this.step);
    if (steps > this.maxSteps) {
      // Spiral-of-death guard: drop the backlog instead of trying to catch up.
      steps = this.maxSteps;
      this.accumulator = 0;
      return steps;
    }
    this.accumulator -= steps * this.step;
    return steps;
  }

  /** Interpolation factor between the previous and current fixed step. */
  get alpha(): number {
    return this.accumulator / this.step;
  }
}
