/**
 * Asset loading front door. M1 is fully procedural (greybox first, CLAUDE.md §8),
 * so for now this only makes sure web fonts are ready before canvas signage is
 * drawn. GLB/KTX2 loading (meshopt + KTX2 via glTF-Transform) lands here in M2.
 */
export class AssetManager {
  private fontsReady: Promise<void> | null = null;

  /** Resolve once the HUD/signage fonts are usable (or after a timeout). */
  ensureFonts(timeoutMs = 2500): Promise<void> {
    if (this.fontsReady) return this.fontsReady;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return (this.fontsReady = Promise.resolve());
    const loads = Promise.all([
      fonts.load('800 64px Mukta', 'मुंबई BEST'),
      fonts.load('600 32px Mukta', 'बस थांबा'),
      fonts.load('64px "Bebas Neue"', 'HORN OK PLEASE'),
    ]).then(() => undefined);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    this.fontsReady = Promise.race([loads, timeout]).catch(() => undefined);
    return this.fontsReady;
  }
}
