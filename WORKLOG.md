# ISLAND — Worklog

## Status: COMPLETE (all phases implemented and tested as far as the environment allows)

## Deliverable
- `index.html` (repo root) — the entire game, self-contained, offline, no dependencies.
- Built from `src/*.{html,js}` by `./build.sh` (plain concatenation). Edit `src/`, then rebuild.
- Tests: `node test/run_tests.js` (56 checks, all passing). Harness: `test/harness.js` (vm + DOM/canvas stubs).

## Environment notes
- Sandbox has Node 22 but NO browser and no network access for installing one → browser verification was
  done headless against the built index.html; a static server (`python3 -m http.server 8000`) serves a live preview.

## Architecture (single file, sections in src/)
- 10_core: cyrb128 seed hash, sfc32 RNG, coordinate hash, seeded gradient noise (fBm/ridged), packed-int colors.
- 20_world: 400×400 coarse grid (6 m cells, 2400 m world). Pipeline: plan geography → base terrain
  (island mask, coast cliffs/bays, hills, secondary ridge, near-convex dominant mountain + spire + dome cap)
  → lakes (rim-levelled basins) → rivers (momentum downhill trace, carving, bank floors) → mountain guarantee
  → gradients/BFS distances → biomes → landmarks → A* worn paths → spawn.
- 25_visibility (MountainGuarantee): validates line of sight to the summit cap rim (S.h−0.8 @ 14 m radius)
  from EVERY land/water-edge cell at centre+half offsets, plus quarter offsets on risky (steep/water) cells.
  Distance-based sampling: 0.75 m steps near the viewer (real-eye criterion, catches sub-cell risers),
  3 m+adaptive steps far (low-eye + large clearance). Obstructions include a continuous inland water surface
  (one-node conservative smear, cached obs field). Fixes: gaussian eff-weighted lowering (viewer-coupled,
  crater-capped) escalating to hard clamps (never undermining the viewer's own support); outer loop repeats
  all phases until the final verify (eye 0.8, clearance 1.2) reports ZERO violations. Exemptions (both proven
  sound): within 86 m of the tip, and chords steeper than 0.52 (the spire's bounded profile means the summit
  face itself fills the view). Terrain is only ever lowered → monotone convergence. Gen time 2–30 s/seed.
- 30_chunks: 48 m chunks, per-chunk RNG from seed+coords, LRU 360, per-biome prop densities, landmark clearings.
- 40_player: exponential approach velocity (frame-rate independent), gravity/jump, step/slope limits,
  circle push-out vs props + landmark colliders, swimming (float at surface, slower), boundary clamp.
- 50_render: per-column terrain ray march (y-buffer, adaptive steps, FULL 2800 m range → summit never culled),
  biome glyph/color selection w/ hash variety + slope shading + altitude blend; billboard objects sorted
  far→near with per-cell depth test; multi-tier ASCII patterns (LOD); sky gradient, sun/moon/stars/cloud bands;
  rain/fog/lightning overlays; glyph atlas (char+15-bit color) blitted per cell.
- 60_map: full-island canvas map (M), static layer cached per world, legend/north/seed/live coords/marker.
- 70_atmosphere: day/night (sun/moon, light RGB ramps), weighted weather Markov chain w/ 14 s smoothing,
  wildlife (passive birds, butterflies), procedural Web Audio (noise-bed wind/waves/rain/river, chirps, thunder).
- 80_game: state machine (title/loading/playing/paused/map/settings), settings incl. quality presets,
  pointer lock + hint, resize, tab-hide pause, landmark piece/collider construction, main loop with dt clamp.

## Key decisions & gotchas (for future work)
- Dominant mountain is kept NEAR-CONVEX (gentle noise) — convex cones are visible from their own flanks,
  which is what lets the validator converge without trenching the mountain.
- The guarantee targets the cap RIM, not the tip (the tip of any rounded dome is geometrically occluded
  by the dome itself — seeing the cap structure is the correct formalization).
- Validation exemptions MUST be eye-consistent between fix and verify passes (a fix pass that exempts a
  superset of verify leaves unfixed rays → use constant 1.8 m offset, tighter than the real 1.65 m eye).
- Hard clamps must skip the viewer's own support nodes or they dig runaway craters.
- waterLevelAt is a continuous bilinear surface (quad max fill) — max-of-4 semantics created phantom
  "water walls" that broke validation.
- Renderer water-phase index must use fract() — negative world coords once produced negative glyph indices.

## Verification summary (what was actually run)
- `node test/run_tests.js`: 56/56 pass (load, determinism, biomes, finiteness, rivers/lakes, visibility
  verify=0 + rendered-frame silhouette checks + min-renderdist no-cull, chunks determinism/LRU, movement
  (fps-independence, jump, swim, boundary, slope block), quality presets, map, day/night, weather, audio
  fallback, loop/resize, no global regen during play, memory growth bound).
- 15-seed sweep: verify violations 0 on all; independent detailed random LOS audit 0 fails on all.
- Title→loading→playing→pause→map→settings→title flow exercised headless; empty seed rejected with message.
- NOT verifiable here: real pointer-lock feel, visual color output, audible audio (no browser in sandbox).
