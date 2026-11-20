import * as THREE from 'three/webgpu';
import { AssetManager } from './AssetManager';
import { createGameBus, type GameBus } from './events';
import { Input } from './Input';
import { QUALITY_PRESETS, saveSettings, type SettingsData } from './Settings';
import { createGameStore, type GameState, type Store } from './Store';
import { FixedStepClock } from './Time';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { GameRenderer } from '../render/Renderer';
import { PostFX } from '../render/PostFX';
import { SkySystem } from '../render/sky/SkySystem';
import { TimeOfDay } from '../render/sky/TimeOfDay';
import { lightUniforms } from '../render/lightUniforms';
import { buildTestTrack, loopCenterline, type TestTrack } from '../world/testtrack/TestTrack';
import { LaneGraph } from '../world/roads/LaneGraph';
import { TrafficSystem } from '../ai/TrafficSystem';
import { PathCrowd } from '../actors/npcs/PathCrowd';
import { VehicleManager } from '../actors/vehicles/VehicleManager';
import type { Vehicle } from '../actors/vehicles/Vehicle';
import { PlayerController } from '../actors/player/PlayerController';
import { PlayerCamera } from '../actors/player/PlayerCamera';
import { Npc, OUTFITS } from '../actors/npcs/Npc';
import { WaypointDriver } from '../ai/WaypointDriver';
import { RigInstancer } from '../actors/rig/RigInstancer';
import { Crowd, type CrowdHazard } from '../actors/npcs/Crowd';
import { buildBazaarStreet, type BazaarStreet } from '../world/districts/BazaarStreet';
import { buildColaba, buildConnector, loadColabaData, type ColabaDistrict } from '../world/districts/Colaba';
import { InteractionSystem } from '../gameplay/InteractionSystem';
import { cityDensity } from '../gameplay/cityRhythm';
import { AudioSystem } from '../audio/AudioSystem';
import { Hud } from '../ui/Hud';
import { PerfHud } from '../ui/PerfHud';
import { PauseMenu } from '../ui/PauseMenu';
import { DevPanel } from '../ui/DevPanel';
import { parseClock } from './Settings';
import { GameplayLayer } from './GameplayLayer';
import { Particles } from '../render/Particles';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  settings: SettingsData;
  forceWebGL: boolean;
  onStatus: (text: string) => void;
}

const _v = new THREE.Vector3();

/**
 * Boots and runs the game: renderer, physics, world, actors, systems, UI.
 * Systems are wired here and talk through the EventBus (CLAUDE.md §6).
 */
export class Engine {
  readonly bus: GameBus = createGameBus();
  readonly store: Store<GameState> = createGameStore();
  readonly scene = new THREE.Scene();
  readonly clock = new FixedStepClock(60);
  input!: Input;
  gr!: GameRenderer;
  physics!: PhysicsWorld;
  cam!: PlayerCamera;
  sky!: SkySystem;
  post!: PostFX;
  tod!: TimeOfDay;
  track!: TestTrack;
  vehicles!: VehicleManager;
  player!: PlayerController;
  npcs = new Map<string, Npc>();
  instancer!: RigInstancer;
  crowd!: Crowd;
  bazaar!: BazaarStreet;
  graph!: LaneGraph;
  traffic!: TrafficSystem;
  pathCrowd!: PathCrowd;
  colaba!: ColabaDistrict;
  connectorTo = new THREE.Vector3();
  /** Named places added by later districts (missions reference them). */
  extraPlaces: Record<string, THREE.Vector3> = {};
  game!: GameplayLayer;
  particles!: Particles;
  interaction!: InteractionSystem;
  audio!: AudioSystem;
  hud!: Hud;
  perf!: PerfHud;
  menu!: PauseMenu;
  dev!: DevPanel;
  settings: SettingsData;
  firstPerson = false;
  private last = performance.now();
  private goodFrames = 0;
  private gpuMs = 0;
  private gpuPending = false;
  private gpuFrame = 0;

  /** Every 20 frames, time how long the GPU takes to drain this frame's work (WebGPU only). */
  private sampleGpu(): void {
    const device = (this.gr.renderer.backend as { device?: GPUDevice }).device;
    if (!device || this.gpuPending || ++this.gpuFrame % 20) return;
    this.gpuPending = true;
    const t0 = performance.now();
    device.queue
      .onSubmittedWorkDone()
      .then(() => {
        this.gpuMs = performance.now() - t0;
      })
      .finally(() => {
        this.gpuPending = false;
      });
  }
  private warmResolve: (() => void) | null = null;
  /** Resolves once frames run smoothly (shaders/pipelines compiled). */
  readonly warm = new Promise<void>((r) => (this.warmResolve = r));

  private constructor(private readonly opts: EngineOptions) {
    this.settings = opts.settings;
  }

  static async create(opts: EngineOptions): Promise<Engine> {
    const e = new Engine(opts);
    await e.init();
    return e;
  }

  private async init(): Promise<void> {
    const { canvas, ui, onStatus } = this.opts;
    const quality = QUALITY_PRESETS[this.settings.quality];
    onStatus('Starting renderer…');
    this.gr = await GameRenderer.create(canvas, quality, this.opts.forceWebGL);
    this.gr.dynamicEnabled = this.settings.dynamicResolution;
    onStatus(`Renderer: ${this.gr.backend}. Loading physics…`);
    this.physics = await PhysicsWorld.create();
    this.input = new Input(canvas);

    this.cam = new PlayerCamera(this.physics, window.innerWidth / window.innerHeight);
    this.scene.add(this.cam.camera);
    this.sky = new SkySystem(this.scene, this.gr.renderer, quality);
    this.sky.setCamera(this.cam.camera);
    this.post = new PostFX(this.gr.renderer, this.scene, this.cam.camera, quality);
    this.tod = new TimeOfDay({
      mode: this.settings.timeMode,
      manualMinutes: this.settings.manualMinutes,
      speed: this.settings.timeSpeed,
    });

    onStatus('Painting signboards…');
    await new AssetManager().ensureFonts();
    onStatus('Building the test track…');
    this.track = buildTestTrack(this.scene, this.physics, quality.maxPointLights);
    onStatus('Building the bazaar street…');
    this.bazaar = buildBazaarStreet(this.scene, this.physics, this.track.lights);
    onStatus('Loading Colaba (OpenStreetMap)…');
    const colabaData = await loadColabaData();
    const colabaOffset = new THREE.Vector3(941, 0, 867);
    this.colaba = buildColaba(this.scene, this.physics, colabaData, colabaOffset, this.track.lights);
    const connFrom = new THREE.Vector3(111, 0, 150);
    const connTo = buildConnector(this.scene, colabaData, colabaOffset, connFrom);
    this.connectorTo = connTo;

    // Lane graph from every drivable road (CLAUDE.md §4.3).
    this.graph = new LaneGraph();
    this.graph.addRoad({
      pts: loopCenterline(2)
        .map((p) => p.p)
        .concat([loopCenterline(2)[0]!.p]),
      width: 12,
      cls: 'loop',
    });
    this.graph.addRoad({
      pts: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(220, 0, 1)],
      width: 12,
      cls: 'bazaar',
    });
    this.graph.addRoad({
      pts: [connFrom, new THREE.Vector3(connFrom.x, 0, Math.max(connFrom.z + 20, connTo.z - 40)), connTo],
      width: 10,
      cls: 'connector',
    });
    for (const r of this.colaba.roads) this.graph.addRoad(r);
    this.track.lights.build();
    this.instancer = new RigInstancer(this.scene, 420);

    onStatus('Parking vehicles…');
    this.vehicles = new VehicleManager(this.scene, this.physics, this.bus);
    this.particles = new Particles(this.scene);
    this.vehicles.particles = this.particles;
    const P = this.track.parking;
    for (const p of [...this.bazaar.parked, ...this.colaba.parked])
      this.vehicles.spawn(p.profile, p.id, p.pos, p.yaw);
    this.vehicles.spawn('lorry', 'lorry', P.lorry.pos, P.lorry.yaw);
    const auto = this.vehicles.spawn('auto-rickshaw', 'auto', P.auto.pos, P.auto.yaw);
    const bus = this.vehicles.spawn('best-bus', 'bus', P.bus.pos, P.bus.yaw);

    this.player = new PlayerController(
      this.scene,
      this.physics,
      this.bazaar.spawn.pos,
      this.bazaar.spawn.yaw,
      (c) => this.vehicleHit(c),
    );
    this.player.onFellInSea = () => {
      this.respawn();
      this.bus.emit('ui:toast', { text: 'Splash! Raju swam back to the promenade.' });
    };
    this.cam.yaw = this.bazaar.spawn.yaw;

    // NPC drivers and passengers.
    const addNpc = (id: string, outfit: keyof typeof OUTFITS, v: Vehicle, seatId: string): void => {
      const n = new Npc(id, OUTFITS[outfit]!, this.scene, this.physics, this.instancer);
      const seat = v.seat(seatId);
      if (seat) n.sitIn(v, seat);
      this.npcs.set(id, n);
    };
    addNpc('auto-driver', 'autoDriver', auto, 'driver');
    addNpc('bus-driver', 'busDriver', bus, 'driver');
    addNpc('bus-p1', 'sareeWoman', bus, 'seat-1');
    addNpc('bus-p2', 'officeWorker', bus, 'seat-4');
    addNpc('bus-p3', 'kurtaMan', bus, 'seat-6');
    addNpc('bus-p4', 'dabbawala', bus, 'stand-2');
    addNpc('bus-p5', 'student', bus, 'door-rear');

    this.crowd = new Crowd(this.scene, this.instancer, this.bazaar.crowdArea, 140, this.bazaar.idleSpots);
    this.pathCrowd = new PathCrowd(this.scene, this.instancer, this.graph, 80);
    const TRAFFIC: Record<string, number> = { ultra: 30, high: 24, medium: 16, low: 10 };
    this.traffic = new TrafficSystem(
      this.scene,
      this.physics,
      this.vehicles,
      this.graph,
      this.instancer,
      TRAFFIC[this.settings.quality] ?? 20,
      (self) => {
        const out: THREE.Vector3[] = [];
        const sp = self.root.position;
        if (this.player.isOnFoot || this.player.state === 'ragdoll') out.push(this.player.position);
        for (const v of this.vehicles.list) {
          if (v === self || !v.active) continue;
          if (Math.abs(v.root.position.x - sp.x) < 30 && Math.abs(v.root.position.z - sp.z) < 30)
            out.push(v.root.position);
        }
        return out;
      },
      this.npcs,
    );

    const obstacles = (self: Vehicle) => (): THREE.Vector3[] => {
      const out: THREE.Vector3[] = [];
      if (this.player.isOnFoot || this.player.state === 'ragdoll') out.push(this.player.position);
      for (const v of this.vehicles.list) if (v !== self) out.push(v.root.position);
      return out;
    };
    const route = this.track.route;
    bus.ai = new WaypointDriver(bus.physics, route, {
      cruise: bus.profile.ai.cruiseSpeed,
      alwaysDrive: true,
      halfWidth: bus.profile.chassis.halfExtents[0],
      halfLength: bus.profile.chassis.halfExtents[2],
      obstacles: obstacles(bus),
    });
    auto.ai = new WaypointDriver(auto.physics, route, {
      cruise: auto.profile.ai.cruiseSpeed,
      alwaysDrive: false,
      halfWidth: auto.profile.chassis.halfExtents[0],
      halfLength: auto.profile.chassis.halfExtents[2],
      obstacles: obstacles(auto),
    });

    this.interaction = new InteractionSystem(
      this.input,
      this.player,
      this.vehicles,
      this.npcs,
      this.physics,
      this.bus,
      this.store,
    );
    this.audio = new AudioSystem(this.cam.camera, this.scene, this.bus, (id) => this.vehicles.get(id));
    this.audio.setVolume(this.settings.muted ? 0 : this.settings.masterVolume);

    this.hud = new Hud(ui, this.bus, this.store);
    this.perf = new PerfHud(ui, this.gr, this.physics, () => QUALITY_PRESETS[this.settings.quality].label);
    this.perf.setVisible(this.settings.showPerfHud);
    this.menu = new PauseMenu(ui, this.settings, this.bus, () => this.resume());
    this.dev = new DevPanel(this.tod, this.sky, this.vehicles, this.player, {
      teleportTo: (id) => this.teleportTo(id),
      places: {
        'Gateway of India': () =>
          this.teleportPlace(this.colaba.gateway.clone().add(new THREE.Vector3(-55, 0, -45)), 2.2),
        'Taj Mahal Palace': () =>
          this.teleportPlace(this.colaba.gateway.clone().add(new THREE.Vector3(-60, 0, -45)), -1.05),
        'Bazaar street': () => this.teleportPlace(this.bazaar.spawn.pos, this.bazaar.spawn.yaw),
      },
      respawn: () => this.respawn(),
      onTimeChange: () => this.menu.syncClock(this.tod.clockMinutes),
    });

    this.game = new GameplayLayer(this, ui);
    this.bus.on('settings:changed', ({ settings }) => this.applySettings(settings));
    this.bus.on('player:ragdoll', () => undefined);
    this.player.onRagdoll = (speed) => this.bus.emit('player:ragdoll', { speed });

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tod.resync();
    });
    document.addEventListener('pointerlockchange', () => {
      const s = this.store.get();
      if (s.started && !this.input.pointerLocked && !s.paused) this.pause();
    });
    canvas.addEventListener('click', () => {
      if (this.store.get().started && !this.store.get().paused) this.input.requestPointerLock();
    });

    this.onResize();
    // Compile every material up front so the first seconds of play don't stutter.
    onStatus('Compiling shaders…');
    try {
      await this.gr.renderer.compileAsync(this.scene, this.cam.camera);
    } catch (err) {
      console.warn('Shader precompile skipped', err);
    }
    this.gr.renderer.setAnimationLoop(() => this.frame());
  }

  /** Called from the start button (a user gesture: pointer lock + audio). */
  start(): void {
    this.store.set({ started: true, paused: false });
    this.audio.start();
    this.input.requestPointerLock();
  }

  pause(): void {
    this.store.set({ paused: true });
    this.input.enabled = false;
    this.menu.show(true);
    this.bus.emit('ui:pause', { paused: true });
  }

  resume(): void {
    this.store.set({ paused: false });
    this.input.enabled = true;
    this.menu.show(false);
    this.audio.start();
    this.input.requestPointerLock();
    this.bus.emit('ui:pause', { paused: false });
  }

  private applySettings(s: SettingsData): void {
    const prev = this.settings;
    this.settings = s;
    this.gr.dynamicEnabled = s.dynamicResolution;
    this.perf.setVisible(s.showPerfHud);
    this.audio.setVolume(s.muted ? 0 : s.masterVolume);
    if (s.timeMode !== prev.timeMode) this.tod.setMode(s.timeMode);
    if (s.manualMinutes !== prev.manualMinutes) this.tod.setManualMinutes(s.manualMinutes);
    this.tod.speed = s.timeSpeed;
  }

  private onResize = (): void => {
    this.gr.resize(window.innerWidth, window.innerHeight);
    this.cam.setAspect(window.innerWidth / window.innerHeight);
  };

  private vehicleHit(center: THREE.Vector3): THREE.Vector3 | null {
    for (const v of this.vehicles.list) {
      const lv = v.physics.body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (speed < 4) continue;
      if (v.distanceTo(center) < 0.35) return new THREE.Vector3(lv.x, lv.y, lv.z);
    }
    return null;
  }

  private readonly hazardPool: CrowdHazard[] = [];
  private crowdHazards(): CrowdHazard[] {
    const out = this.hazardPool;
    out.length = 0;
    for (const v of this.vehicles.list) {
      const lv = v.physics.body.linvel();
      if (lv.x * lv.x + lv.z * lv.z < 4) continue;
      out.push({
        player: v === this.player.seat?.vehicle,
        position: v.root.position,
        velocity: new THREE.Vector3(lv.x, 0, lv.z),
        radius: Math.max(v.profile.chassis.halfExtents[0], v.profile.chassis.halfExtents[2] * 0.6),
      });
    }
    return out;
  }

  teleportPlace(pos: THREE.Vector3, yaw: number): void {
    if (!this.player.isOnFoot) return;
    const p = pos.clone();
    p.y = this.physics.groundHeight(p.x, p.z, 60, 0) + 0.05;
    this.player.teleport(p, yaw);
    this.cam.yaw = yaw;
  }

  locationName(): string {
    const p = this.player.position;
    const room = this.game?.interiors.find((c) => c.inside);
    if (room) return `${room.data.title} · Bazaar street`;
    if (this.colaba.bounds.containsPoint(new THREE.Vector2(p.x, p.z)))
      return p.distanceTo(this.colaba.gateway) < 220 ? 'Apollo Bunder · Colaba' : 'Colaba';
    if (Math.abs(p.z) < 20 && p.x > 6 && p.x < 214) return 'Bazaar street';
    if (p.x < -7) return 'Sea-face promenade';
    return 'Test track';
  }

  respawn(): void {
    this.player.teleport(this.bazaar.spawn.pos, this.bazaar.spawn.yaw);
    this.bus.emit('player:respawned', {});
  }

  teleportTo(id: string): void {
    const v = this.vehicles.get(id);
    if (!v || !this.player.isOnFoot) return;
    const seat = v.driverSeat;
    v.exitWorld(seat.def, _v);
    _v.y = this.physics.groundHeight(_v.x, _v.z, _v.y + 3, 0);
    this.player.teleport(_v, v.physics.yaw);
  }

  /** Debug/automation: set the clock (`'18:45'`), frozen. */
  setTime(hhmm: string): void {
    const m = parseClock(hhmm);
    if (m === null) return;
    this.tod.setMode('manual');
    this.tod.speed = 0;
    this.tod.setManualMinutes(m);
  }

  private frame(): void {
    const now = performance.now();
    const frameMs = now - this.last;
    this.last = now;
    const dt = Math.min(frameMs / 1000, 0.1);
    if (this.warmResolve) {
      this.goodFrames = frameMs < 50 ? this.goodFrames + 1 : 0;
      if (this.goodFrames > 20) {
        this.warmResolve();
        this.warmResolve = null;
      }
    }
    const input = this.input;
    input.poll();

    if (input.wasPressed('perfHud')) this.perf.setVisible(!this.perf.visible);
    if (input.wasPressed('devPanel')) this.dev.toggle();
    if (input.wasPressed('mute')) {
      const muted = !this.settings.muted;
      this.settings = { ...this.settings, muted };
      saveSettings(this.settings);
      this.menu.setMuted(muted);
      this.audio.setVolume(muted ? 0 : this.settings.masterVolume);
      this.bus.emit('ui:toast', { text: muted ? 'Sound off (M to unmute)' : 'Sound on' });
    }

    const state = this.store.get();
    const running = state.started && !state.paused;
    if (running) {
      if (input.wasPressed('jump') && this.player.isOnFoot) this.player.queueJump();
      if (input.wasPressed('crouch') && this.player.isOnFoot) this.player.crouched = !this.player.crouched;
      if (input.wasPressed('walk')) this.player.walkMode = !this.player.walkMode;
      if (input.wasPressed('camera') && this.player.seat) this.firstPerson = !this.firstPerson;
      this.interaction.update();
    }
    if (!this.player.seat) this.firstPerson = false;

    // Before the player clicks Start the world still simulates (attract mode: the bus runs its route).
    const steps = state.paused ? 0 : this.clock.advance(dt);
    const move = running ? input.moveVector() : { x: 0, y: 0 };
    const sprint = running && input.isDown('sprint');
    for (let i = 0; i < steps; i++) {
      const h = this.clock.step;
      this.interaction.fixedUpdate();
      this.vehicles.fixedUpdate(h);
      this.player.fixedUpdate(h, { ...move, sprint }, this.cam.moveYaw);
      this.physics.step(h);
      this.vehicles.postStep();
    }
    const alpha = this.clock.alpha;
    const pv = this.player.seat?.vehicle ?? null;
    this.vehicles.syncVisuals(alpha, pv?.id ?? null);
    this.player.frameUpdate(dt, alpha);
    for (const n of this.npcs.values()) n.update(state.paused ? 0 : dt);
    if (!state.paused) {
      const hz = this.crowdHazards();
      this.crowd.update(dt, this.player.position, hz);
      this.pathCrowd.update(dt, this.player.position, hz);
      this.traffic.update(
        dt,
        this.player.position,
        this.cam.camera,
        this.audio.density,
        lightUniforms.street.value > 0.5,
        this.player.seat?.vehicle ?? null,
      );
    }
    this.instancer.update();

    this.tod.update(dt);
    const look = running ? input.lookDelta(dt) : { x: 0, y: 0 };
    this.cam.update(dt, {
      playerPos: this.player.rig.root.position,
      crouched: this.player.crouched,
      vehicle: this.player.state === 'seated' ? pv : null,
      seat: this.player.seat?.seat.def ?? null,
      firstPerson: this.firstPerson,
      lookX: look.x,
      lookY: look.y,
      wheel: running ? input.wheelDelta() : 0,
      sensitivity: this.settings.mouseSensitivity,
      invertY: this.settings.invertY,
      excludeBody: this.player.state === 'seated' && pv ? pv.physics.body : null,
      aiming: this.player.aiming,
    });
    this.player.rig.setVisible(this.cam.mode !== 'firstPerson');
    this.sky.update(this.tod, this.cam.camera, this.post);
    this.track.lights.update(dt, this.cam.camera.position);
    lightUniforms.time.value += dt;

    this.audio.density = cityDensity(this.tod.clockMinutes);
    this.crowd.setDensity(this.audio.density);
    this.pathCrowd.density = this.audio.density;
    this.audio.update(
      dt,
      this.cam.camera.position,
      pv && this.player.seat?.seat.def.type === 'driver' ? pv : null,
    );
    this.game.update(dt, running);
    if (!state.paused) this.particles.update(dt);
    this.hud.update(
      dt,
      this.tod.clockMinutes,
      this.sky.phase,
      this.tod.mode,
      pv ? pv.physics.speedKmh : null,
      pv?.name ?? null,
      this.locationName(),
    );

    this.gr.renderer.info.reset();
    this.post.render();
    this.perf.update(frameMs);
    // Drive dynamic resolution from our own cost (CPU work + sampled GPU time), not the
    // frame interval: browsers can cap rAF (power saving, 30 Hz displays) and that is not our load.
    const workMs = performance.now() - now;
    this.sampleGpu();
    if (!this.warmResolve)
      this.gr.updateDynamicResolution(this.gpuMs > 0 ? Math.max(workMs, this.gpuMs) : frameMs, dt);
    input.endFrame();
  }
}
