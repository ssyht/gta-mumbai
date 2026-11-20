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
      blips.push({ x: s.pos.x, z: s.pos.z, kind: s.restaurant ? 'restaurant' : 'shop' });
    const tgt = this.missions.target;
    if (tgt) blips.push({ x: tgt.x, z: tgt.z, kind: 'mission' });
    else
      for (const sp of this.missions.startPoints) blips.push({ x: sp.pos.x, z: sp.pos.z, kind: 'mission' });
    blips.push({ x: e.colaba.gateway.x, z: e.colaba.gateway.z, kind: 'landmark', label: '⛩' });
    this.minimap.update(dt, me, e.player.yaw, e.cam.yaw, blips);
    this.status.update(dt, e.player.aiming, this.wanted.bustProgress);

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 30;
      if (!this.missions.active) this.save();
    }
  }
}
