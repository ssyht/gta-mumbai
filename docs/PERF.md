# Performance log

Budgets (CLAUDE.md §7): 60 FPS @ 1080p on RTX 3060 / M1; 30 FPS on Iris Xe (Low); ≤ 1,500 draw calls; ≤ 3M visible triangles.

## M0 + M1: test track (2026-11-18)

Measured with the on-screen perf HUD in Chrome via DevTools automation. Machine: Apple Silicon MacBook (120 Hz display, so FPS is vsync-capped at 120).

| Scene | Backend · preset | Canvas | FPS | Draw calls | Triangles | JS heap |
|---|---|---|---|---|---|---|
| Spawn, blue hour (18:05) | WebGPU · High | 2268×1086 | 120 (8.3 ms) | 246 | 0.08M | 68 MB |
| Facing the skyline, golden hour (17:35) | WebGPU · High | 2268×1086 | 120 | 492–526 | 0.15–0.16M | 120–132 MB |
| Driving the hatchback, noon (11:30) | WebGPU · High | 2268×1086 | 120 | 281 | 0.14M | ~200 MB |
| Riding the BEST bus (door-hang), dusk (18:10) | WebGPU · High | 2268×1086 | 120 | 521 | 0.16M | 95 MB |
| Night (21:30) | WebGL2 · Low (FXAA) | 1512×724 | 120 | 503 | 0.16M | 118 MB |

Physics step: 0.1–0.2 ms (5 vehicles, player, ragdolls on demand).

Notes
- Every number is far inside budget. Draw calls are dominated by the greybox humanoids (≈15 meshes each) and per-sign planes; M3 moves characters to a skinned, instanced rig.
- Dynamic resolution never dropped below 100% on this machine.
- Not yet measured on the RTX 3060 / Iris Xe reference machines.
- Initial download: see `npm run build` output (three ≈ 1.2 MB, rapier ≈ 2 MB with embedded WASM, before gzip). Well under the 40 MB limit.
