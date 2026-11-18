import type { GameBus } from '../core/events';
import type { GameState, Store } from '../core/Store';
import type { TimeMode } from '../core/Settings';
import { PHASE_LABEL, type DayPhase } from '../render/sky/lightingCurves';
import { formatClock } from '../render/sky/TimeOfDay';

const MODE_LABEL: Record<TimeMode, string> = {
  sync: 'Your clock · Mumbai sky',
  ist: 'Mumbai time (IST)',
  manual: 'Manual time',
};

const SEAT_LABEL: Record<string, string> = {
  passenger: 'Passenger',
  standing: 'Standing · holding the rail',
  doorHang: 'Hanging off the door',
};

/** Gameplay HUD: clock, prompts, toasts, speedometer, fare meter. */
export class Hud {
  private readonly clock: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly speedo: HTMLElement;
  private readonly fare: HTMLElement;
  private toastTimer = 0;
  private lastClock = '';

  constructor(
    parent: HTMLElement,
    bus: GameBus,
    private readonly store: Store<GameState>,
  ) {
    const mk = (id: string): HTMLElement => {
      const e = document.createElement('div');
      e.id = id;
      parent.appendChild(e);
      return e;
    };
    this.clock = mk('clock');
    this.prompt = mk('prompt');
    this.toast = mk('toast');
    this.speedo = mk('speedo');
    this.fare = mk('fare');
    bus.on('ui:prompt', ({ text }) => this.setPrompt(text));
    bus.on('ui:toast', ({ text }) => this.showToast(text));
    bus.on('fare:update', (f) => {
      this.fare.style.display = f.active ? 'block' : 'none';
      this.fare.innerHTML = `<small>METER</small><b>₹${f.rupees.toFixed(2)}</b><small>${f.km.toFixed(2)} km</small>`;
    });
  }

  private setPrompt(text: string | null): void {
    if (!text) {
      this.prompt.style.opacity = '0';
      return;
    }
    // "F  Drive Auto     G  Ride…" → key chips.
    this.prompt.innerHTML = text
      .split(/\s{5}/)
      .map((part) => {
        const m = /^(\S+)\s{2}(.*)$/.exec(part);
        return m ? `<span><kbd>${m[1]}</kbd>${m[2]}</span>` : `<span>${part}</span>`;
      })
      .join('');
    this.prompt.style.opacity = '1';
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toast.style.transform = 'translate(-50%, 0)';
    this.toastTimer = 3.5;
  }

  update(
    dt: number,
    clockMinutes: number,
    phase: DayPhase,
    mode: TimeMode,
    speedKmh: number | null,
    vehicleName: string | null,
    location = '',
  ): void {
    const c = `${formatClock(clockMinutes)}|${phase}|${mode}|${location}`;
    if (c !== this.lastClock) {
      this.lastClock = c;
      this.clock.innerHTML = `<b>${formatClock(clockMinutes)}</b><span>${PHASE_LABEL[phase]}</span><small>${MODE_LABEL[mode]}</small>${location ? `<em>${location}</em>` : ''}`;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toast.style.opacity = '0';
        this.toast.style.transform = 'translate(-50%, -8px)';
      }
    }
    const s = this.store.get();
    if (s.player.mode === 'driving' && speedKmh !== null) {
      this.speedo.style.display = 'block';
      this.speedo.innerHTML = `<b>${Math.round(speedKmh)}</b><small>km/h</small><span>${vehicleName ?? ''}</span>`;
    } else if (s.player.mode === 'passenger') {
      this.speedo.style.display = 'block';
      this.speedo.innerHTML = `<span>${vehicleName ?? ''}</span><small>${SEAT_LABEL[s.player.seatType ?? ''] ?? ''}</small>`;
    } else {
      this.speedo.style.display = 'none';
    }
  }
}
