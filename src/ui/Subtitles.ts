/**
 * Subtitles (SCENARIOS.md A5): speaker name in their colour, the Bambaiya
 * Hindi line, and the English line underneath. Toggled in Settings.
 */
export class Subtitles {
  private readonly el: HTMLElement;
  private time = 0;
  enabled = true;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'subtitles';
    parent.appendChild(this.el);
  }

  show(speaker: string, color: string, hindi: string, english: string, seconds: number): void {
    if (!this.enabled) return;
    const esc = (s: string): string =>
      s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    this.el.innerHTML = `<p><b style="color:${color}">${esc(speaker)}:</b> ${esc(hindi)}</p><span>${esc(english)}</span>`;
    this.el.classList.add('on');
    this.time = seconds;
  }

  update(dt: number): void {
    if (this.time <= 0) return;
    this.time -= dt;
    if (this.time <= 0) this.el.classList.remove('on');
  }
}
