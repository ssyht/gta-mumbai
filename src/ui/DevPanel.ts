import GUI from 'lil-gui';
import type { PlayerController } from '../actors/player/PlayerController';
import type { VehicleManager } from '../actors/vehicles/VehicleManager';
import type { TimeOfDay } from '../render/sky/TimeOfDay';
import { formatClock } from '../render/sky/TimeOfDay';
import type { SkySystem } from '../render/sky/SkySystem';

export interface DevPanelHooks {
  teleportTo: (vehicleId: string) => void;
  respawn: () => void;
  onTimeChange: () => void;
}

/**
 * lil-gui dev panel (P): time-of-day slider + speed, look tweaks, live vehicle
 * tuning (suspension, friction, engine, steering), player tuning, teleports.
 */
export class DevPanel {
  readonly gui: GUI;

  constructor(
    tod: TimeOfDay,
    sky: SkySystem,
    vehicles: VehicleManager,
    player: PlayerController,
    hooks: DevPanelHooks,
  ) {
    this.gui = new GUI({ title: 'Dev panel (P)', width: 320 });
    this.gui.domElement.style.zIndex = '30';

    const time = this.gui.addFolder('Time of day');
    const t = {
      mode: tod.mode,
      clock: tod.clockMinutes,
      label: formatClock(tod.clockMinutes),
      speed: tod.speed,
      syncNow: () => {
        tod.setMode('sync');
        t.mode = 'sync';
        hooks.onTimeChange();
        time.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    };
    time
      .add(t, 'mode', {
        'Sync to my clock': 'sync',
        'Real Mumbai time (IST)': 'ist',
        'Manual / time-lapse': 'manual',
      })
      .name('Mode')
      .onChange((m: 'sync' | 'ist' | 'manual') => {
        tod.setMode(m);
        hooks.onTimeChange();
      });
    time
      .add(t, 'clock', 0, 1439, 1)
      .name('Clock (min)')
      .onChange((v: number) => {
        tod.setMode('manual');
        tod.setManualMinutes(v);
        t.mode = 'manual';
        t.label = formatClock(v);
        hooks.onTimeChange();
        time.controllersRecursive().forEach((c) => c.updateDisplay());
      });
    time.add(t, 'label').name('HH:MM').disable();
    time
      .add(t, 'speed', [0, 1, 10, 60, 300, 1200])
      .name('Time-lapse ×')
      .onChange((v: number) => {
        tod.speed = Number(v);
        hooks.onTimeChange();
      });
    time.add(t, 'syncNow').name('Sync to my clock');

    const look = this.gui.addFolder('Look');
    look.add(sky, 'exposureBias', 0.3, 3, 0.01).name('Exposure bias');
    look.add(sky, 'fogBias', 0, 4, 0.01).name('Haze density');
    look.add(sky.sky.cloudCoverage, 'value', 0, 1, 0.01).name('Cloud cover');

    const veh = this.gui.addFolder('Vehicle tuning');
    const sel = { vehicle: vehicles.list[0]?.id ?? '' };
    let tuningFolder: GUI | null = null;
    const buildTuning = (): void => {
      tuningFolder?.destroy();
      const v = vehicles.get(sel.vehicle);
      if (!v) return;
      const f = (tuningFolder = veh.addFolder(v.name));
      const apply = (): void => v.physics.applyTuning();
      const tu = v.physics.tuning;
      const s = f.addFolder('Suspension');
      s.add(tu.suspension, 'stiffness', 5, 120, 0.5).onChange(apply);
      s.add(tu.suspension, 'compression', 0.5, 12, 0.1).onChange(apply);
      s.add(tu.suspension, 'relaxation', 0.5, 12, 0.1).onChange(apply);
      s.add(tu.suspension, 'restLength', 0.05, 0.6, 0.01).onChange(apply);
      s.add(tu.suspension, 'maxTravel', 0.05, 0.5, 0.01).onChange(apply);
      const ty = f.addFolder('Tyres');
      ty.add(tu.tyres, 'frictionSlip', 0.3, 6, 0.05).onChange(apply);
      ty.add(tu.tyres, 'sideFrictionStiffness', 0.2, 3, 0.05).onChange(apply);
      const e = f.addFolder('Engine & brakes');
      const fmax = v.profile.engine.force * 3;
      e.add(tu.engine, 'force', 0, fmax, fmax / 300);
      e.add(tu.engine, 'topSpeedKmh', 10, 220, 1);
      e.add(tu.engine, 'brakeForce', 0, v.profile.engine.brakeForce * 4, v.profile.engine.brakeForce / 100);
      e.add(
        tu.engine,
        'handbrakeForce',
        0,
        v.profile.engine.handbrakeForce * 4,
        v.profile.engine.handbrakeForce / 100,
      );
      const st = f.addFolder('Steering & stability');
      st.add(tu.steering, 'maxAngle', 0.1, 1.0, 0.01);
      st.add(tu.steering, 'speed', 0.3, 8, 0.05);
      st.add(tu.steering, 'highSpeedFactor', 0.1, 1, 0.01);
      st.add(tu.stability, 'rollFactor', 0, 2, 0.01).name('roll (tip) factor');
      st.add(tu.stability, 'uprightAssist', 0, 3, 0.01);
      st.add(tu, 'comHeight', -1.5, 1, 0.01).name('CoM height').onChange(apply);
      f.add({ reset: () => v.physics.reset() }, 'reset').name('Flip / reset');
    };
    veh
      .add(sel, 'vehicle', Object.fromEntries(vehicles.list.map((v) => [v.name, v.id])))
      .name('Vehicle')
      .onChange(buildTuning);
    buildTuning();

    const pl = this.gui.addFolder('Player');
    pl.add(player.tuning, 'walk', 0.5, 4, 0.05);
    pl.add(player.tuning, 'jog', 1, 8, 0.05);
    pl.add(player.tuning, 'sprint', 2, 14, 0.05);
    pl.add(player.tuning, 'jumpVelocity', 2, 10, 0.05);
    pl.add(player.tuning, 'gravity', 5, 40, 0.5);

    const go = this.gui.addFolder('Teleport');
    for (const v of vehicles.list) go.add({ go: () => hooks.teleportTo(v.id) }, 'go').name(`→ ${v.name}`);
    go.add({ go: hooks.respawn }, 'go').name('→ Spawn');

    for (const f of [veh, pl, go]) f.close();
    this.gui.hide();
  }

  /** Select a vehicle in the tuning dropdown (e.g. the one the player just entered). */
  toggle(): void {
    if (this.gui._hidden) this.gui.show();
    else this.gui.hide();
  }
}
