/**
 * The phone (CLAUDE.md §4.8): T opens it, number keys pick an app, T or Esc
 * closes. Kept keyboard-driven so pointer lock (and the game) never pause.
 */
export interface PhoneApp {
  key: string;
  label: string;
  dev?: string;
  run: () => void;
}

export class Phone {
  readonly el: HTMLElement;
  open = false;
  private apps: PhoneApp[] = [];
  private sub: { title: string; items: PhoneApp[] } | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'phone';
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      const items = this.sub ? this.sub.items : this.apps;
      const idx = Number(e.key) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < items.length) {
        e.preventDefault();
        e.stopPropagation();
        items[idx]!.run();
      } else if (e.code === 'Backspace' && this.sub) {
        this.sub = null;
        this.render();
      }
    });
  }

  setApps(apps: PhoneApp[]): void {
    this.apps = apps;
    this.render();
  }

  /** Show a list inside the phone (e.g. missions). */
  showList(title: string, items: PhoneApp[]): void {
    this.sub = { title, items };
    this.render();
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    if (!this.open) this.sub = null;
    this.el.classList.toggle('open', this.open);
    this.render();
  }

  private render(): void {
    const items = this.sub ? this.sub.items : this.apps;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.el.innerHTML = `
      <div class="bar"><span>Jio-ish 5G</span><span>${time}</span></div>
      <h4>${this.sub ? this.sub.title : 'Raju’s phone'}</h4>
      <ol>${items.map((a, i) => `<li><kbd>${i + 1}</kbd>${a.label}${a.dev ? `<small>${a.dev}</small>` : ''}</li>`).join('')}</ol>
      <p>${this.sub ? 'Backspace: back · ' : ''}T: close</p>`;
  }
}
