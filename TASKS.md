# ISLAND — Development Checklist

Legend: [x] implemented AND verified by the headless test suite (`node test/run_tests.js`, 56/56 pass)
· [x*] implemented, verified as far as the environment allows (no real browser in sandbox)

## Phase 1: Foundation
- [x] Single `index.html` with embedded CSS/JS, canvas, title screen, seed input, Play/Settings (built from `src/` by `build.sh`)
- [x] Main loop (requestAnimationFrame, delta time, spike clamping, tab-switch pause)
- [x*] Pointer lock acquire / loss / recapture (code paths exercised headless; real mouse capture needs a browser)
- [x] First-person ASCII renderer foundation (character grid, glyph atlas, planar perspective projection)

## Phase 2: Global geography
- [x] Seed hashing (cyrb128) + sfc32 RNG + seeded gradient noise (fBm, ridged)
- [x] Island mask, coastline with bays/cliff sections, finite world (2400×2400 m, deep-ocean edges verified)
- [x] Coarse heightfield 400×400 (typed arrays), rolling hills, secondary ridge
- [x] Dominant mountain (340–380 m summit, near-convex cone, snapped to grid node)
- [x] Biome grid: ocean, shallows, beach, cliffs, grass, meadow, forest, dense forest, hills, rock, snow, lake, river, path, marsh, summit — all verified present

## Phase 3: Mountain guarantee (the hard requirement)
- [x] Elevation cap: all non-dominant terrain ≤ 40 % of summit height (verified: second peak < 45 %)
- [x] LOS validation over the ENTIRE coarse land grid: cell centres + half-cell offsets + quarter-cell
      offsets on risky cells (~300–580k rays per world), eye 0.8 m, clearance 1.2 m → 0 violations
- [x] Smooth gaussian terrain lowering + hard-clamp escalation, outer loop repeats until verify is clean
- [x] Conservative margins cover real eye (1.65 m) and bounded surface detail (±0.8 m)
- [x] Water treated as obstruction (continuous inland water surface, one-node conservative smear)
- [x] Steep-chord exemption: sightlines steeper than the spire profile see the summit face itself
- [x] Independent detailed check (float positions, full-detail heightfield): 0 failures on 15/15 seeds
      × ~17 000 random land/water points each
- [x] Renderer marches terrain to full world extent — summit never culled by object render distance (test)

## Phase 4: Detailed world
- [x] Chunk manager: 48 m chunks, hash-seeded, LRU-capped (360), deterministic across eviction/regen (tests)
- [x] Conifers, deciduous trees, dead trees, bushes, rocks, flowers, logs, stumps, reeds — per-biome densities
- [x] Rare landmarks: ruins (walls + doorway), abandoned bus/truck, standing stones, rock arch, boulder field, optional hut ruin
- [x] Worn paths: A* on downsampled grid between landmarks/beaches, smoothed + rasterized, kept clear of props

## Phase 5: Terrain interaction
- [x] Rivers: springs on high ground, momentum-driven downhill trace, carve + bank floors, drain to sea/lake/pond
- [x] Lakes: rim-levelled basins; ponds formed by stuck rivers
- [x] Player physics: exponential accel/decel (frame-rate independent — verified 30 vs 144 fps < 6 % diff), gravity, jump (verified arc + landing), step limit, slope block (verified can't climb the spire)
- [x] Collision: trees/rocks/landmark circle push-out; axis-separated movement
- [x] Swimming: auto float in deep water, slower movement, no survival mechanics (verified float depth)
- [x] World boundary clamp far out at sea (verified)

## Phase 6: Map
- [x] Full island map on M from the very start, color-coded biomes, hillshade, summit ▲, landmarks, legend, north arrow, seed, live player coords + view direction (headless render verified)
- [x] Static layer cached once per world; dynamic marker per frame; rebuilds on resize

## Phase 7: Atmosphere
- [x] Day/night: sun/moon azimuth+elevation, light color ramps (night/dusk/day), stars, verified light sweep
- [x] Weather state machine: clear/haze/clouds/fog/rain/heavy/storm, weighted transitions, 14 s smoothing (verified ≥2 transitions in 20 sim-minutes)
- [x] ASCII rain streaks, drifting ground fog, animated water, cloud bands, lightning flash + delayed thunder
- [x] Wind-swayed trees/reeds/grass shimmer; passive birds (never approach) + meadow butterflies
- [x] Web Audio: wind/waves/rain/river noise beds, gust LFO, bird chirps, thunder — all procedural, volume + mute settings, graceful without AudioContext (verified)

## Phase 8: Menus & optimization
- [x] Loading screen with real generation progress + visibility pass log
- [x] Pause (Resume / Settings / Return to Title), settings overlay from title or pause (flow verified)
- [x] Settings: quality presets, ASCII density, render distance, FOV, weather FX, life, crosshair, sensitivity, inverted Y, walk/sprint speed, audio on/off + volume, day length — no persistence by design
- [x] Resize mid-game, pointer-lock hint, pause on tab hide
- [x] Performance: typed-array buffers, glyph atlas, adaptive ray steps, chunk LRU, ~7 ms/frame native at 150 cols (headless, no blit)

## Phase 9: Testing
- [x] 56/56 automated checks pass (`node test/run_tests.js`) — covers load, determinism, world structure,
      mountain visibility (validation + rendered frames), chunks, movement, renderer, map, atmosphere,
      audio fallback, loop/resize/memory
- [x] 15 seeds generation-swept: all verify 0 violations, 0 detailed LOS failures
- [x] Title→loading→playing→pause→map→settings→title flow verified headless
- [x*] Real-browser interaction (mouse look feel, actual canvas pixels, Web Audio output) — NOT testable in
      this sandbox (no browser); verified by headless equivalents + served live preview

## Known limitations
- No real-browser smoke test was possible in the sandbox (no Chromium/Firefox available; network restricted).
  The strongest available alternative (vm + DOM/canvas stubs against the BUILT index.html) passes everything.
- Sub-metre waterline slivers at coastal cliff feet are validated via quarter-cell sampling; the independent
  random float-position audit found 0 failures on all 15 swept seeds.
