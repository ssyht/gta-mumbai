import * as THREE from 'three/webgpu';
import type { Engine } from './Engine';
import { WantedSystem } from '../ai/WantedSystem';
import { Combat, type Targetable } from '../gameplay/Combat';
import { Pickups, PlayerStats } from '../gameplay/PlayerStats';
import { Robbery } from '../gameplay/Robbery';
import { applySave, readSave, writeSave } from '../gameplay/SaveGame';
import { MissionSystem } from '../gameplay/MissionSystem';
import { Radio } from '../audio/Radio';
import { Minimap, type Blip } from '../ui/Minimap';
import { StatusHud } from '../ui/StatusHud';
import { Phone } from '../ui/Phone';
import { TouchControls } from '../ui/TouchControls';
import { Weather } from '../render/Weather';
import { InteriorCell, type InteriorData } from '../world/interiors/InteriorCell';
import { InteriorAudio } from '../audio/InteriorAudio';
import { Subtitles } from '../ui/Subtitles';
import { ScenarioDirector } from '../gameplay/scenario/ScenarioDirector';
import { KiranaScenario } from '../gameplay/shop/KiranaScenario';
import laxmiGeneral from '../data/interiors/laxmi-general.json';

const INTERIOR_DATA: Record<string, InteriorData> = {
  'laxmi-general': laxmiGeneral as unknown as InteriorData,
};

/**
 * M5 + M8 systems on top of the engine: health/money, combat, wanted level &
 * police, robbery, missions, radio, weather, minimap, phone, save/load and
 * touch controls. Systems still only talk through the bus and the store; this
 * layer just builds them and feeds them each frame.
 */
export class GameplayLayer {
  readonly stats: PlayerStats;
  readonly wanted: WantedSystem;
  readonly combat: Combat;
  readonly robbery: Robbery;
  readonly missions: MissionSystem;
  readonly radio: Radio;
  readonly weather: Weather;
  readonly minimap: Minimap;
  readonly status: StatusHud;
  readonly phone: Phone;
  readonly places: Record<string, THREE.Vector3>;
  readonly scenario = new ScenarioDirector();
  readonly interiors: InteriorCell[] = [];
  readonly interiorAudio: InteriorAudio;
  readonly subtitles: Subtitles;
  kirana: KiranaScenario | null = null;
  private adapt = 1;
  private readonly pickups: Pickups;
  private saveTimer = 30;
  private copShot = 0;
  private photo = false;

  constructor(
    private readonly e: Engine,
    ui: HTMLElement,
  ) {
    const { bus, store } = e;
    const LAND = 0.045;
    const g = e.colaba.gateway;
    const cto = e.connectorTo;
    this.places = {
      bazaarWest: new THREE.Vector3(26, 0.2, -7.75),
      bazaarScooter: new THREE.Vector3(30, 0.02, -3.2),
      hospital: new THREE.Vector3(196, 0.2, 7.9),
      policeStation: new THREE.Vector3(60, 0.05, 92),
      trackGarage: new THREE.Vector3(150, 0.05, 104),
      trackPolice: new THREE.Vector3(126, 0.05, 96),
      gateway: g.clone().add(new THREE.Vector3(-48, LAND, -30)),
      tajFront: g.clone().add(new THREE.Vector3(-88, LAND, -25)),
      colabaTaxiStand: g.clone().add(new THREE.Vector3(-70, LAND, 5)),
      colabaNorth: cto.clone(),
      connectorTop: new THREE.Vector3(111, 0.05, 172),
      connectorBottom: new THREE.Vector3(111, 0.05, Math.max(190, cto.z - 40)),
      ...e.extraPlaces,
    };
    const crowds: Targetable[] = [e.crowd, e.pathCrowd];

    this.stats = new PlayerStats(bus, store, {
      hospital: () => e.teleportPlace(this.places.hospital!, -Math.PI / 2),
      station: () => e.teleportPlace(this.places.policeStation!, 0),
      clearWanted: () => this.wanted.clear(),
    });
    this.wanted = new WantedSystem(
      e.scene,
      e.physics,
      e.vehicles,
      e.graph,
      e.instancer,
      e.npcs,
      bus,
      store,
      () => {
        const v = e.player.seat?.vehicle;
        if (v) {
          const lv = v.physics.body.linvel();
          return { pos: v.root.position, vel: new THREE.Vector3(lv.x, 0, lv.z), onFoot: false };
        }
        return {
          pos: e.player.position,
          vel: new THREE.Vector3(),
          onFoot: e.player.isOnFoot || e.player.state === 'ragdoll',
        };
      },
    );
    this.combat = new Combat(
      e.scene,
      e.input,
      e.player,
      e.cam.camera,
      e.physics,
      e.vehicles,
      crowds,
      bus,
      store,
      (id) => id.startsWith('police'),
    );
    this.robbery = new Robbery(e.bazaar.shopFronts, e.input, e.player, this.stats, crowds, bus, (n) =>
      this.wanted.atLeast(n),
    );
    this.missions = new MissionSystem(e.scene, bus, store, {
      places: this.places,
      playerPos: () => e.player.position,
      playerVehicle: () => (e.player.state === 'seated' ? (e.player.seat?.vehicle ?? null) : null),
      spawnVehicle: (profile, at) => e.vehicles.spawn(profile, `mission-${profile}-${Date.now()}`, at, 0),
      wantedLevel: () => this.wanted.level,
      setWanted: (n) => this.wanted.atLeast(n),
      earn: (amount, reason) => this.stats.earn(amount, reason),
      save: () => this.save(),
    });
    this.radio = new Radio(e.audio.context, e.audio.listener.getInput());
    this.weather = new Weather(e.scene);
    this.weather.collectWetSurfaces();
    this.weather.onRain = (a) => e.audio.setRain(a);
    this.weather.onThunder = () => e.audio.thunder();
    this.pickups = new Pickups(e.scene, [
      { pos: new THREE.Vector3(30, 0.2, 62), kind: 'ammo' },
      { pos: this.places.hospital!.clone().add(new THREE.Vector3(-6, 0, 0)), kind: 'health' },
      { pos: this.places.policeStation!.clone().add(new THREE.Vector3(4, 0, 0)), kind: 'armour' },
      { pos: this.places.gateway!.clone().add(new THREE.Vector3(-8, 0, -8)), kind: 'health' },
    ]);

    // Walk-in interiors (SCENARIOS.md A1) and the C1 Kirana scenario.
    this.interiorAudio = new InteriorAudio(e.audio.listener);
    this.subtitles = new Subtitles(ui);
    this.subtitles.enabled = e.settings.subtitles;
    for (const slot of e.bazaar.interiors) {
      const data = INTERIOR_DATA[slot.id];
      if (!data) continue;
      const cell = new InteriorCell(e.scene, e.physics, slot, data);
      cell.onShutter = (_opening, at) =>
        this.interiorAudio.clink('shutter', at.distanceTo(e.cam.camera.position));
      this.interiors.push(cell);
      // The old hold-E robbery uses the counter, and only with a gun out (C2 lands in Pack 3).
      const sf = e.bazaar.shopFronts.find((f) => f.interior === slot.id);
      if (sf)
        sf.pos.copy(
          cell.toWorld(
            new THREE.Vector3(data.interaction.counterFront.x, 0.05, data.interaction.counterFront.z),
          ),
        );
      if (data.kind === 'kirana') {
        this.kirana = new KiranaScenario(
          cell,
          {
            playerRig: e.player.rig,
            playerPos: () => e.player.position,
            playerYaw: () => e.player.yaw,
            teleportPlayer: (feet, yaw) => {
              e.player.teleport(feet, yaw);
              e.cam.yaw = yaw;
            },
            playerOnFoot: () => e.player.isOnFoot,
            armed: () => e.store.get().weapon === 'pistol',
            camera: e.cam.camera,
            input: e.input as unknown as { wasPressed(a: string): boolean; isDown(a: string): boolean },
            money: () => e.store.get().stats.money,
            pay: (amount, reason) => this.stats.pay(amount, reason),
            heal: (hp) => this.stats.heal(hp),
            hint: (text) => bus.emit('ui:hint', { text }),
            toast: (text) => bus.emit('ui:toast', { text }),
            clockMinutes: () => e.tod.clockMinutes,
            smoke: (at) =>
              e.particles.emit('smoke', at, {
                size: 0.03,
                life: 2.2,
                spread: 0.02,
                vel: new THREE.Vector3(0, 0.25, 0),
              }),
          },
          this.interiorAudio,
          this.scenario,
          this.subtitles,
          ui,
        );
      }
    }
    this.robbery.skip = (s) => !!s.interior && store.get().weapon !== 'pistol';

    this.minimap = new Minimap(ui, e.graph);
    this.status = new StatusHud(ui, bus, store);
    this.phone = new Phone(ui);
    this.phone.setApps([
      { key: 'missions', label: 'Missions', dev: 'मिशन', run: () => this.showMissions() },
      { key: 'taxi', label: 'Call a taxi', dev: 'टॅक्सी', run: () => this.callTaxi() },
      { key: 'camera', label: 'Camera mode (hide HUD)', run: () => this.togglePhoto() },
      { key: 'radio', label: 'Radio: next station', run: () => this.nextStation() },
      {
        key: 'weather',
        label: 'Weather: change',
        run: () => bus.emit('ui:toast', { text: `Weather: ${this.weather.cycle()}` }),
      },
      {
        key: 'save',
        label: 'Save game',
        run: () =>
          bus.emit('ui:toast', { text: this.save() ? 'Game saved' : 'Could not save (storage blocked)' }),
      },
    ]);
    if (TouchControls.wanted()) new TouchControls(ui, e.input);

    bus.on('vehicle:carjacked', () => bus.emit('crime', { kind: 'carjack', at: e.player.position }));
    e.crowd.onPlayerHit = () => bus.emit('crime', { kind: 'hitPedestrian', at: e.player.position });
    e.pathCrowd.onPlayerHit = () => bus.emit('crime', { kind: 'hitPedestrian', at: e.player.position });
    bus.on('player:died', () => {
      e.player.startRagdoll(new THREE.Vector3(0, 0, 0), 0.2);
      this.missions.fail('You were hospitalised');
    });
    // Fall damage: starts at 4 m, lethal at 15 m (GAME_SPEC §5.2).
    e.player.onLanded = (h) => this.stats.damage(Math.min(100, ((h - 4) / 11) * 100), 'fall');
    e.player.onDrowning = (dps) => this.stats.damage(dps / 60, 'drowning');
    bus.on('vehicle:exploded', ({ vehicleId, at }) => {
      const p = new THREE.Vector3(at.x, at.y, at.z);
      e.audio.explosion(at);
      for (const c of crowds) {
        c.strike(p, new THREE.Vector3(0, 0, 1), 9);
        c.strike(p, new THREE.Vector3(0, 0, -1), 9);
        c.panic(p, 60);
      }
      const me = e.player.position;
      const d = me.distanceTo(p);
      if (d < 10 && e.player.state !== 'seated') {
        const dir = me.clone().sub(p).setY(0).normalize();
        e.player.startRagdoll(dir.multiplyScalar(9 * (1 - d / 10)).setY(5), 3);
        this.stats.damage(70 * (1 - d / 10), 'explosion');
      } else if (d < 6 && e.player.seat?.vehicle.id !== vehicleId) {
        this.stats.damage(30, 'explosion');
      }
      if (e.player.seat?.vehicle.id === vehicleId) {
        this.stats.damage(100, 'explosion');
      }
    });
    bus.on('radio:changed', ({ station }) =>
      bus.emit('ui:toast', { text: station ? `📻 ${station}` : 'Radio off' }),
    );

    // Continue from the last save.
    const saved = readSave();
    if (saved) {
      applySave(store, saved);
      if (saved.radio) this.radio.set(saved.radio);
      if (saved.position)
        e.teleportPlace(
          new THREE.Vector3(saved.position.x, saved.position.y, saved.position.z),
          saved.position.yaw,
        );
    }
  }

  private floorPlanOf(c: InteriorCell): NonNullable<Minimap['floorPlan']> {
    const rect = (x: number, z: number, w: number, d: number, color: string) => ({
      corners: (
        [
          [x - w / 2, z - d / 2],
          [x + w / 2, z - d / 2],
          [x + w / 2, z + d / 2],
          [x - w / 2, z + d / 2],
        ] as Array<[number, number]>
      ).map(([lx, lz]) => {
        const p = c.toWorld(new THREE.Vector3(lx, 0, lz));
        return [p.x, p.z] as [number, number];
      }),
      color,
    });
    const rects = [rect(0, -c.slot.roomD / 2, c.slot.roomW, c.slot.roomD, 'rgba(232, 222, 200, 0.55)')];
    for (const p of c.data.props) {
      if (p.type === 'counter' || p.type === 'counterReturn')
        rects.push(rect(p.x, p.z, Number(p.w), Number(p.d), 'rgba(70, 120, 180, 0.9)'));
      if (p.type === 'rack' || p.type === 'woodRack')
        rects.push(rect(p.x, p.z, Number(p.w), Number(p.d), 'rgba(150, 160, 165, 0.9)'));
      if (p.type === 'fridge') rects.push(rect(p.x, p.z, 0.62, 0.6, 'rgba(240, 240, 240, 0.95)'));
    }
    rects.push(rect(0, 0.1, c.slot.doorWidth, 0.2, 'rgba(255, 207, 26, 0.9)'));
    return { rects, label: c.data.title };
  }

  private showMissions(): void {
    const list = this.missions.available.map((m) => ({
      key: m.id,
      label: `${this.missions.isDone(m.id) ? '✓ ' : ''}${m.title}`,
      dev: `${m.dev} · ₹${m.reward.toLocaleString('en-IN')}`,
      run: () => {
        this.phone.toggle(false);
        this.e.input.enabled = true;
        if (this.missions.active) {
          this.e.bus.emit('ui:toast', { text: 'Finish your current mission first' });
          return;
        }
        // Go to the mission's start marker.
        const p = this.places[m.start]!;
        this.e.teleportPlace(p.clone().add(new THREE.Vector3(3, 0, 0)), 0);
        this.e.bus.emit('ui:toast', { text: `${m.title}: walk into the yellow marker` });
      },
    }));
    this.phone.showList('Missions', list);
  }

  private callTaxi(): void {
    const node = this.e.graph.nearest(this.e.player.position, 60);
    if (!node) {
      this.e.bus.emit('ui:toast', { text: 'No road nearby for a taxi' });
      return;
    }
    this.e.vehicles.spawn('taxi', `called-taxi-${Date.now()}`, node.p.clone(), Math.random() * 6);
    this.e.bus.emit('ui:toast', { text: 'Your kaali-peeli is waiting at the nearest road' });
    this.phone.toggle(false);
    this.e.input.enabled = true;
  }

  private togglePhoto(): void {
    this.photo = !this.photo;
    document.body.classList.toggle('photo', this.photo);
    this.phone.toggle(false);
    this.e.input.enabled = true;
  }

  private nextStation(): void {
    const st = this.radio.next();
    this.e.bus.emit('radio:changed', { station: st ? `${st.name} ${st.freq}` : null });
  }

  save(): boolean {
    const p = this.e.player;
    const pos = p.isOnFoot ? { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw } : null;
    return writeSave(this.e.store, pos, this.radio.current?.id ?? null);
  }

  update(dt: number, running: boolean): void {
    const e = this.e;
    const input = e.input;
    const pv = e.player.state === 'seated' ? (e.player.seat?.vehicle ?? null) : null;
    if (input.wasPressed('phone')) {
      this.phone.toggle();
      input.enabled = !this.phone.open;
    }
    if (this.photo && input.wasPressed('pause')) this.togglePhoto();
    if (running && !this.phone.open) {
      if (input.wasPressed('radio') && pv) this.nextStation();
      if (this.stats.downTime <= 0) {
        this.combat.update(dt);
        this.robbery.update(dt);
      }
    }
    // Interiors: portal culling, shutter hours, threshold blend, then the scenarios.
    this.scenario.tick(dt);
    let indoor = 0;
    let near = 0;
    let insideCell: InteriorCell | null = null;
    const now = new Date();
    for (const c of this.interiors) {
      c.update(dt, e.cam.camera, e.player.position, e.tod.clockMinutes, now.getDay());
      indoor = Math.max(indoor, c.indoor);
      near = Math.max(near, 1 - Math.min(1, c.doorPosition.distanceTo(e.cam.camera.position) / 12));
      if (c.inside) insideCell = c;
    }
    if (running) this.kirana?.update(dt);
    e.cam.indoor = indoor;
    e.cam.room = insideCell
      ? { floor: insideCell.slot.floorY, ceiling: insideCell.slot.floorY + insideCell.slot.roomH }
      : null;
    this.interiorAudio.update(indoor, near, e.settings.muted ? 0 : e.settings.masterVolume);
    this.subtitles.enabled = e.settings.subtitles;
    this.subtitles.update(dt);
    // Eye adaptation, eased over ~0.8 s. Sky light reaches the room unoccluded, so by day the
    // interior needs less exposure than the street (and the street flares briefly on the way out);
    // at night the room's tubes are the brightest thing around.
    const day = Math.max(0, Math.min(1, e.tod.state.sunAltitude * 4));
    const want = 1 - indoor * (0.28 * day - 0.12 * (1 - day));
    this.adapt += (want - this.adapt) * Math.min(1, dt / 0.8);
    e.sky.adaptation = this.adapt;
    this.minimap.floorPlan = insideCell ? this.floorPlanOf(insideCell) : null;

    // Stats/death/arrest run even while the screen card is up.
    this.stats.update(dt);
    input.enabled = !this.phone.open && this.stats.downTime <= 0 && !e.store.get().paused;
    this.wanted.update(dt, e.cam.camera, pv);
    this.missions.update(dt);
    this.pickups.update(dt, e.player.position, this.stats, e.store, e.bus);
    this.weather.update(dt, e.cam.camera.position);
    e.sky.weatherCloud = this.weather.cloud;
    e.sky.weatherRain = this.weather.rain;
    e.sky.weatherHaze = this.weather.haze;
    e.sky.weatherFlash = this.weather.flash;
    // Wet roads: tyre grip x0.75 (GAME_SPEC §4.3).
    const grip = 1 - 0.25 * this.weather.wetness;
    for (const v of e.vehicles.list) v.physics.gripScale = grip;
    this.radio.volume = e.settings.muted ? 0 : e.settings.masterVolume;
    this.radio.update(dt, !!e.player.seat, e.settings.muted);

    // Police shoot at you from 3 stars.
    const level = this.wanted.level;
    this.copShot -= dt;
    if (level >= 3 && this.copShot <= 0 && this.stats.downTime <= 0) {
      this.copShot = 0.8;
      const me = pv ? pv.root.position : e.player.position;
      for (const v of this.wanted.policeVehicles) {
        if (v.root.position.distanceTo(me) < 28 && Math.random() < 0.35) {
          e.audio.gunshot(v.root.position);
          this.stats.damage(pv ? 3 : 7, 'police');
          break;
        }
      }
    }
    // Siren from the nearest police car.
    let nearest: THREE.Vector3 | null = null;
    let nd = 260;
    for (const v of this.wanted.policeVehicles) {
      const d = v.root.position.distanceTo(e.cam.camera.position);
      if (d < nd) {
        nd = d;
        nearest = v.root.position;
      }
    }
    e.audio.updateSiren(level > 0 ? nearest : null);

    // Minimap.
    const blips: Blip[] = [];
    for (const v of this.wanted.policeVehicles)
      blips.push({ x: v.root.position.x, z: v.root.position.z, kind: 'police' });
    const me = e.player.position;
    // Only the handful of nearest robbable shops, or the radar turns into confetti.
    const nearShops = this.robbery.list
      .filter((s) => this.robbery.available(s))
      .map((s) => ({ s, d: Math.hypot(s.pos.x - me.x, s.pos.z - me.z) }))
      .filter((x) => x.d < 160)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    for (const { s } of nearShops)
      blips.push({ x: s.pos.x, z: s.pos.z, kind: s.kind === 'restaurant' ? 'restaurant' : 'shop' });
    const tgt = this.missions.target;
    if (tgt) blips.push({ x: tgt.x, z: tgt.z, kind: 'mission' });
    else
      for (const sp of this.missions.startPoints) blips.push({ x: sp.pos.x, z: sp.pos.z, kind: 'mission' });
    blips.push({ x: e.colaba.gateway.x, z: e.colaba.gateway.z, kind: 'landmark', label: '⛩' });
    this.minimap.update(dt, me, e.player.yaw, e.cam.yaw, blips);
    this.status.update(
      dt,
      e.player.aiming || !!this.kirana?.browsing,
      this.wanted.bustProgress,
      e.player.stamina,
    );

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      if (!this.missions.active) this.save();
    }
  }
}
