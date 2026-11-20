/**
 * Scenario Director (SCENARIOS.md A6), first slice: every scenario logs its
 * beats here with a timestamp so tests can check order and timing, and
 * scenarios register debug drivers so `window.__game.scenario.run(id)` and
 * `.step()` can force a run beat by beat for screenshots. The data-driven
 * beat-graph runner lands with Pack 2.
 */
export interface BeatEntry {
  t: number;
  scenario: string;
  beat: string;
  data?: Record<string, unknown>;
}

export interface ScenarioDriver {
  run(opts: Record<string, unknown>): void;
  step(): boolean;
}

export class ScenarioDirector {
  readonly log: BeatEntry[] = [];
  private readonly drivers = new Map<string, ScenarioDriver>();
  private active: ScenarioDriver | null = null;
  private clock = 0;
  onBeat: ((e: BeatEntry) => void) | null = null;

  tick(dt: number): void {
    this.clock += dt;
  }

  get now(): number {
    return this.clock;
  }

  register(id: string, d: ScenarioDriver): void {
    this.drivers.set(id, d);
  }

  get ids(): string[] {
    return [...this.drivers.keys()];
  }

  beat(scenario: string, beat: string, data?: Record<string, unknown>): void {
    const e: BeatEntry = {
      t: Math.round(this.clock * 1000) / 1000,
      scenario,
      beat,
      ...(data ? { data } : {}),
    };
    this.log.push(e);
    if (this.log.length > 2000) this.log.splice(0, 500);
    this.onBeat?.(e);
  }

  /** Beat names for one scenario, in order. */
  beats(scenario: string, since = 0): string[] {
    return this.log.filter((e) => e.scenario === scenario && e.t >= since).map((e) => e.beat);
  }

  run(id: string, opts: Record<string, unknown> = {}): boolean {
    const d = this.drivers.get(id);
    if (!d) return false;
    this.active = d;
    d.run(opts);
    return true;
  }

  /** Advance the active debug run by one beat. False when it has finished. */
  step(): boolean {
    return this.active ? this.active.step() : false;
  }

  clear(): void {
    this.log.length = 0;
  }
}
