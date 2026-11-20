import type { Action, Input } from '../core/Input';

/**
 * Mobile/touch controls (CLAUDE.md §9 M8): a virtual stick on the left, drag
 * anywhere on the right half to look, and big action buttons. Only shown on
 * coarse-pointer devices.
 */
const BUTTONS: Array<{ action: Action; label: string }> = [
  { action: 'jump', label: 'JUMP' },
  { action: 'interact', label: 'F' },
  { action: 'passenger', label: 'G' },
  { action: 'attack', label: 'HIT' },
  { action: 'horn', label: 'HORN' },
  { action: 'sprint', label: 'RUN' },
  { action: 'use', label: 'E' },
  { action: 'phone', label: '📱' },
];

export class TouchControls {
  readonly el: HTMLElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private origin = { x: 0, y: 0 };
  private lastLook = { x: 0, y: 0 };

  static wanted(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  }

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.innerHTML = `<div class="stick"><i></i></div><div class="btns">${BUTTONS.map((b) => `<button data-a="${b.action}">${b.label}</button>`).join('')}</div>`;
    parent.appendChild(this.el);
    const stick = this.el.querySelector('.stick') as HTMLElement;
    const knob = stick.querySelector('i') as HTMLElement;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]!;
      this.stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      this.origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    });
    window.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.stickId) {
            const dx = Math.max(-1, Math.min(1, (t.clientX - this.origin.x) / 50));
            const dy = Math.max(-1, Math.min(1, (t.clientY - this.origin.y) / 50));
            knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
            this.input.setVirtualMove(dx, -dy);
          } else if (t.identifier === this.lookId) {
            this.input.addLook((t.clientX - this.lastLook.x) * 2.2, (t.clientY - this.lastLook.y) * 2.2);
            this.lastLook = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: true },
    );
    const end = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          knob.style.transform = '';
          this.input.setVirtualMove(0, 0);
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    window.addEventListener(
      'touchstart',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (
            t.clientX > window.innerWidth / 2 &&
            !(t.target as HTMLElement).closest('button') &&
            this.lookId === null
          ) {
            this.lookId = t.identifier;
            this.lastLook = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: true },
    );
    for (const b of Array.from(this.el.querySelectorAll('button'))) {
      const a = b.dataset.a as Action;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.input.pressVirtual(a);
      });
      b.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.input.releaseVirtual(a);
      });
    }
  }
}
