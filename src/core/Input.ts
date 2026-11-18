/**
 * Keyboard / mouse / gamepad input mapped to game actions.
 * Touch controls come in M8 (CLAUDE.md §9).
 *
 * Continuous queries (`isDown`, `moveVector`, `throttle`, ...) can be read
 * from fixed steps; edge queries (`wasPressed`) are valid for one rendered
 * frame and are cleared by `endFrame()`.
 */
export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'walk'
  | 'interact'
  | 'passenger'
  | 'horn'
  | 'camera'
  | 'reset'
  | 'perfHud'
  | 'devPanel'
  | 'pause';

const KEYMAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  Space: 'jump',
  KeyC: 'crouch',
  KeyX: 'walk',
  KeyF: 'interact',
  KeyG: 'passenger',
  KeyH: 'horn',
  KeyV: 'camera',
  KeyR: 'reset',
  Backquote: 'perfHud',
  KeyP: 'devPanel',
  Escape: 'pause',
};

/** Standard-mapping gamepad buttons → actions. */
const PADMAP: Partial<Record<number, Action>> = {
  0: 'jump', // A
  1: 'crouch', // B
  2: 'passenger', // X
  3: 'interact', // Y
  4: 'sprint', // LB
  9: 'pause', // Start
  8: 'perfHud', // Back
  10: 'horn', // L3
  11: 'camera', // R3
};

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
const DEADZONE = 0.15;

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

export class Input {
  private readonly down = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private readonly padDown = new Set<Action>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;
  private pad: { lx: number; ly: number; rx: number; ry: number; lt: number; rt: number } = {
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    lt: 0,
    rt: 0,
  };
  pointerLocked = false;
  /** Set false while menus are open so gameplay ignores keys. */
  enabled = true;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  requestPointerLock(): void {
    try {
      const p = this.target.requestPointerLock() as unknown;
      if (p instanceof Promise) p.catch(() => undefined);
    } catch {
      // Pointer lock can be refused (iframes, automation); mouse-look just stays off.
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = KEYMAP[e.code];
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (!action) return;
    if (!e.repeat && !this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const action = KEYMAP[e.code];
    if (action) this.down.delete(action);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };

  private readonly onLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.target;
  };

  /** Poll gamepads once per frame (before reading input). */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find((p): p is Gamepad => !!p && p.connected);
    if (!gp) {
      this.padDown.clear();
      this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
      return;
    }
    const ax = (i: number): number => dz(gp.axes[i] ?? 0);
    const btn = (i: number): number => gp.buttons[i]?.value ?? 0;
    this.pad = { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3), lt: btn(6), rt: btn(7) };
    for (const [idx, action] of Object.entries(PADMAP)) {
      if (!action) continue;
      const isDown = (gp.buttons[Number(idx)]?.pressed ?? false) === true;
      if (isDown && !this.padDown.has(action)) this.pressed.add(action);
      if (isDown) this.padDown.add(action);
      else this.padDown.delete(action);
    }
  }

  isDown(a: Action): boolean {
    if (!this.enabled) return false;
    return this.down.has(a) || this.padDown.has(a);
  }

  wasPressed(a: Action): boolean {
    if (!this.enabled && a !== 'pause' && a !== 'perfHud' && a !== 'devPanel') return false;
    return this.pressed.has(a);
  }

  /** On-foot move: x = right, y = forward, length ≤ 1. */
  moveVector(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0) + this.pad.lx;
    let y = (this.down.has('forward') ? 1 : 0) - (this.down.has('back') ? 1 : 0) - this.pad.ly;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** Accelerator 0..1 (W / RT). */
  throttle(): number {
    if (!this.enabled) return 0;
    return Math.max(this.down.has('forward') ? 1 : 0, this.pad.rt);
  }

  /** Brake / reverse 0..1 (S / LT). */
  brake(): number {
    if (!this.enabled) return 0;
    return Math.max(this.down.has('back') ? 1 : 0, this.pad.lt);
  }

  /** Steering -1..1, positive = left (matches the vehicle frame, +X is left). */
  steer(): number {
    if (!this.enabled) return 0;
    const k = (this.down.has('left') ? 1 : 0) - (this.down.has('right') ? 1 : 0);
    return Math.max(-1, Math.min(1, k - this.pad.lx));
  }

  /** Mouse-look delta in pixels plus right-stick contribution, scaled per frame. */
  lookDelta(dt: number): { x: number; y: number } {
    const stick = 900 * dt;
    return { x: this.mouseDx + this.pad.rx * stick, y: this.mouseDy + this.pad.ry * stick };
  }

  wheelDelta(): number {
    return this.wheel;
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
  }
}
