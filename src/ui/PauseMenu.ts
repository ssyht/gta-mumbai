import type { GameBus } from '../core/events';
import {
  QUALITY_PRESETS,
  RELOAD_KEYS,
  saveSettings,
  type QualityPreset,
  type SettingsData,
  type TimeMode,
} from '../core/Settings';
import { formatClock } from '../render/sky/TimeOfDay';

export const CONTROLS: Array<[string, string]> = [
  ['WASD', 'Move · drive'],
  ['Mouse', 'Look (click to capture)'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump · vault · climb · handbrake'],
  ['C / X', 'Crouch / walk toggle'],
  ['F', 'Drive · carjack · get out · jump out'],
  ['G', 'Ride as passenger · change spot'],
  ['H', 'Horn (spam it, this is Mumbai)'],
  ['V', 'Chase / first-person · window view'],
  ['R', 'Flip vehicle back over'],
  ['Esc', 'Menu'],
  ['P / `', 'Dev panel / perf HUD'],
];

/** Pause + settings menu (graphics preset, time-of-day mode, controls). */
export class PauseMenu {
  readonly el: HTMLElement;
  private settings: SettingsData;
  private reloadNote: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    initial: SettingsData,
    private readonly bus: GameBus,
    private readonly onResume: () => void,
  ) {
    this.settings = { ...initial };
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.innerHTML = this.render();
    parent.appendChild(this.el);
    this.bind();
  }

  get current(): SettingsData {
    return this.settings;
  }

  private render(): string {
    const s = this.settings;
    const opt = (v: string, label: string, sel: string): string =>
      `<option value="${v}" ${v === sel ? 'selected' : ''}>${label}</option>`;
    return `
      <div class="panel">
        <h2>Paused</h2>
        <button id="m-resume" class="primary">Resume</button>
        <section>
          <h3>Graphics</h3>
          <label>Preset
            <select id="m-quality">${(Object.keys(QUALITY_PRESETS) as QualityPreset[])
              .map((q) => opt(q, QUALITY_PRESETS[q].label, s.quality))
              .join('')}</select>
          </label>
          <label class="row"><input type="checkbox" id="m-dynres" ${s.dynamicResolution ? 'checked' : ''}/> Dynamic resolution</label>
          <label class="row"><input type="checkbox" id="m-perf" ${s.showPerfHud ? 'checked' : ''}/> Perf HUD</label>
          <p id="m-reload" class="note" hidden>Preset changes apply after a reload. <button id="m-reload-btn">Reload now</button></p>
        </section>
        <section>
          <h3>Time of day</h3>
          <label class="row"><input type="radio" name="m-time" value="sync" ${s.timeMode === 'sync' ? 'checked' : ''}/> Sync to my clock</label>
          <label class="row"><input type="radio" name="m-time" value="ist" ${s.timeMode === 'ist' ? 'checked' : ''}/> Real Mumbai time (IST)</label>
          <label class="row"><input type="radio" name="m-time" value="manual" ${s.timeMode === 'manual' ? 'checked' : ''}/> Manual / time-lapse</label>
          <label>Clock <output id="m-clock-out">${formatClock(s.manualMinutes)}</output>
            <input type="range" id="m-clock" min="0" max="1439" step="1" value="${Math.round(s.manualMinutes)}"/>
          </label>
          <label>Speed
            <select id="m-speed">${[0, 1, 10, 60, 300, 1200]
              .map((v) => opt(String(v), v === 0 ? 'Frozen' : `${v}×`, String(s.timeSpeed)))
              .join('')}</select>
          </label>
        </section>
        <section>
          <h3>Controls</h3>
          <label>Mouse sensitivity <input type="range" id="m-sens" min="0.2" max="3" step="0.05" value="${s.mouseSensitivity}"/></label>
          <label class="row"><input type="checkbox" id="m-invert" ${s.invertY ? 'checked' : ''}/> Invert Y</label>
          <label>Volume <input type="range" id="m-vol" min="0" max="1" step="0.05" value="${s.masterVolume}"/></label>
          <ul class="keys">${CONTROLS.map(([k, d]) => `<li><kbd>${k}</kbd>${d}</li>`).join('')}</ul>
        </section>
      </div>`;
  }

  private bind(): void {
    const $ = <T extends HTMLElement>(id: string): T => this.el.querySelector(`#${id}`) as T;
    $('m-resume').addEventListener('click', () => this.onResume());
    $('m-reload-btn').addEventListener('click', () => location.reload());
    const change = (patch: Partial<SettingsData>): void => {
      const reloadNeeded = (Object.keys(patch) as Array<keyof SettingsData>).some((k) =>
        RELOAD_KEYS.includes(k),
      );
      this.settings = { ...this.settings, ...patch };
      saveSettings(this.settings);
      if (reloadNeeded) ($('m-reload') as HTMLElement).hidden = false;
      this.bus.emit('settings:changed', { settings: this.settings, reloadNeeded });
    };
    $<HTMLSelectElement>('m-quality').addEventListener('change', (e) =>
      change({ quality: (e.target as HTMLSelectElement).value as QualityPreset }),
    );
    $<HTMLInputElement>('m-dynres').addEventListener('change', (e) =>
      change({ dynamicResolution: (e.target as HTMLInputElement).checked }),
    );
    $<HTMLInputElement>('m-perf').addEventListener('change', (e) =>
      change({ showPerfHud: (e.target as HTMLInputElement).checked }),
    );
    this.el
      .querySelectorAll<HTMLInputElement>('input[name="m-time"]')
      .forEach((r) => r.addEventListener('change', () => change({ timeMode: r.value as TimeMode })));
    $<HTMLInputElement>('m-clock').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      $('m-clock-out').textContent = formatClock(v);
      const radio = this.el.querySelector<HTMLInputElement>('input[value="manual"]');
      if (radio) radio.checked = true;
      change({ manualMinutes: v, timeMode: 'manual' });
    });
    $<HTMLSelectElement>('m-speed').addEventListener('change', (e) =>
      change({ timeSpeed: Number((e.target as HTMLSelectElement).value) }),
    );
    $<HTMLInputElement>('m-sens').addEventListener('input', (e) =>
      change({ mouseSensitivity: Number((e.target as HTMLInputElement).value) }),
    );
    $<HTMLInputElement>('m-invert').addEventListener('change', (e) =>
      change({ invertY: (e.target as HTMLInputElement).checked }),
    );
    $<HTMLInputElement>('m-vol').addEventListener('input', (e) =>
      change({ masterVolume: Number((e.target as HTMLInputElement).value) }),
    );
    this.reloadNote = $('m-reload');
  }

  /** Reflect a clock value that changed elsewhere (dev panel). */
  syncClock(minutes: number): void {
    const slider = this.el.querySelector<HTMLInputElement>('#m-clock');
    const out = this.el.querySelector('#m-clock-out');
    if (slider) slider.value = String(Math.round(minutes));
    if (out) out.textContent = formatClock(minutes);
  }

  show(v: boolean): void {
    this.el.classList.toggle('open', v);
    if (v && this.reloadNote) this.syncClock(this.settings.manualMinutes);
  }
}
