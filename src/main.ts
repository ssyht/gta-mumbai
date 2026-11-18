import './styles.css';
import { Engine } from './core/Engine';
import { applyUrlOverrides, loadSettings } from './core/Settings';

/**
 * Boot: settings (+ URL overrides `?time=18:45`, `?quality=low`, `?webgl=1`,
 * `?autostart=1`), renderer selection (WebGPU → WebGL2), then the engine.
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const status = document.getElementById('status') as HTMLElement;
  const startBtn = document.getElementById('start') as HTMLButtonElement;
  const overlay = document.getElementById('title') as HTMLElement;
  const params = new URLSearchParams(location.search);
  const settings = applyUrlOverrides(loadSettings(), location.search);

  try {
    const engine = await Engine.create({
      canvas,
      ui,
      settings,
      forceWebGL: params.has('webgl'),
      onStatus: (t) => (status.textContent = t),
    });
    (window as unknown as { __game: Engine }).__game = engine;
    status.textContent = 'Warming up shaders…';
    await Promise.race([engine.warm, new Promise((r) => setTimeout(r, 45000))]);
    status.textContent = `Ready · ${engine.gr.backend}`;
    startBtn.disabled = false;
    const go = (): void => {
      overlay.classList.add('hidden');
      engine.start();
    };
    startBtn.addEventListener('click', go);
    if (params.has('autostart')) go();
  } catch (err) {
    console.error(err);
    status.textContent = `Could not start: ${(err as Error).message}. This game needs WebGPU or WebGL2.`;
    status.classList.add('error');
  }
}

void boot();
