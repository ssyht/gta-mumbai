import type { GameBus } from '../core/events';
import type { GameState, Store } from '../core/Store';

/**
 * Health/armour bars, money, wanted stars, weapon + ammo, crosshair, the
 * secondary hint line (robbery, pickups), mission objective, arrest progress,
 * and the full-screen "hospitalised" / "arrested" cards.
 */
export class StatusHud {
  private readonly bars: HTMLElement;
  private readonly money: HTMLElement;
  private readonly stars: HTMLElement;
  private readonly weapon: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly card: HTMLElement;
  private readonly bust: HTMLElement;
  private moneyFlash = 0;
  private cardTime = 0;
  private lastKey = '';

  constructor(
    parent: HTMLElement,
    bus: GameBus,
    private readonly store: Store<GameState>,
  ) {
    const mk = (id: string, tag = 'div'): HTMLElement => {
      const e = document.createElement(tag);
      e.id = id;
      parent.appendChild(e);
      return e;
    };
    this.bars = mk('bars');
    this.bars.innerHTML =
      '<div class="hp"><i></i></div><div class="ar"><i></i></div><div class="st"><i></i></div>';
    this.money = mk('money');
    this.stars = mk('stars');
    this.weapon = mk('weapon');
    this.crosshair = mk('crosshair');
    this.hint = mk('hint');
    this.objective = mk('objective');
    this.card = mk('card');
    this.bust = mk('bust');
    bus.on('ui:hint', ({ text }) => {
      this.hint.textContent = text ?? '';
      this.hint.style.opacity = text ? '1' : '0';
    });
    bus.on('money:changed', ({ delta }) => {
      this.moneyFlash = 2;
      this.money.dataset.delta = `${delta > 0 ? '+' : '−'}₹${Math.abs(Math.round(delta)).toLocaleString('en-IN')}`;
      this.money.classList.toggle('loss', delta < 0);
    });
    bus.on('player:died', () => this.showCard('HOSPITALISED', 'अस्पताल · hospital bill ₹1,000'));
    bus.on('player:busted', () => this.showCard('ARRESTED', 'गिरफ्तार · court fine ₹1,500'));
    bus.on('mission:objective', ({ text }) => {
      this.objective.textContent = text;
      this.objective.style.opacity = text ? '1' : '0';
    });
    bus.on('mission:ended', ({ success, reward }) => {
      this.showCard(
        success ? 'MISSION PASSED' : 'MISSION FAILED',
        success ? `+₹${reward.toLocaleString('en-IN')}` : 'Try again from the phone (T)',
      );
      this.objective.style.opacity = '0';
    });
  }

  private showCard(title: string, sub: string): void {
    this.card.innerHTML = `<b>${title}</b><span>${sub}</span>`;
    this.card.classList.add('on');
    this.cardTime = 4.2;
  }

  setVisible(v: boolean): void {
    for (const e of [this.bars, this.money, this.stars, this.weapon, this.objective])
      e.style.display = v ? '' : 'none';
  }

  update(dt: number, aiming: boolean, bustProgress: number, stamina = 100): void {
    const st = this.bars.querySelector('.st') as HTMLElement;
    st.style.opacity = stamina < 99.5 ? '1' : '0';
    (st.querySelector('i') as HTMLElement).style.width = `${stamina}%`;
    const s = this.store.get();
    const key = `${Math.round(s.stats.health)}|${Math.round(s.stats.armour)}|${s.stats.money}|${s.wanted.level}|${s.wanted.evading}|${s.weapon}|${s.ammo}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      (this.bars.querySelector('.hp i') as HTMLElement).style.width = `${s.stats.health}%`;
      (this.bars.querySelector('.ar i') as HTMLElement).style.width = `${s.stats.armour}%`;
      this.bars.classList.toggle('low', s.stats.health < 25);
      this.money.textContent = `₹${s.stats.money.toLocaleString('en-IN')}`;
      this.stars.innerHTML = Array.from(
        { length: 5 },
        (_, i) => `<i class="${i < s.wanted.level ? 'on' : ''}">★</i>`,
      ).join('');
      this.stars.classList.toggle('evading', s.wanted.evading);
      this.stars.style.opacity = s.wanted.level > 0 ? '1' : '0';
      this.weapon.innerHTML =
        s.weapon === 'pistol' ? `<b>PISTOL</b><span>${s.ammo}</span>` : '<b>FISTS</b><span>1 · 2</span>';
    }
    this.crosshair.style.opacity = aiming ? '1' : '0';
    this.bust.style.opacity = bustProgress > 0.02 ? '1' : '0';
    this.bust.style.setProperty('--p', String(bustProgress));
    if (this.moneyFlash > 0) {
      this.moneyFlash -= dt;
      this.money.classList.toggle('flash', this.moneyFlash > 0);
    }
    if (this.cardTime > 0) {
      this.cardTime -= dt;
      if (this.cardTime <= 0) this.card.classList.remove('on');
    }
  }
}
