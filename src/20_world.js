/* =====================================================================
 * 20 — WORLD GENERATION (global geography)
 * Deterministic coarse heightfield + water + biome grids, generated once per world.
 * ===================================================================== */
const GRID = 400;            // cells per side
const CELL = 6;              // meters per cell
const WORLD_SIZE = GRID * CELL;   // 2400 m
const HALF = WORLD_SIZE / 2;      // 1200 m
const SEA_LEVEL = 0;
const DEEP_OCEAN = -45;
const NO_WATER = -1e9;

const BIOME = {
  OCEAN: 0, SHALLOW: 1, BEACH: 2, CLIFF: 3, GRASS: 4, MEADOW: 5, FOREST: 6, DENSE_FOREST: 7,
  HILLS: 8, ROCK: 9, SNOW: 10, LAKE: 11, RIVER: 12, PATH: 13, MARSH: 14, SUMMIT: 15,
};
const BIOME_NAMES = ['Ocean', 'Shallows', 'Beach', 'Cliffs', 'Grassland', 'Meadow', 'Forest', 'Dense forest',
  'Rocky hills', 'Bare rock', 'Snow', 'Lake', 'River', 'Path', 'Marsh', 'Summit'];

class World {
  constructor(seedStr) {
    this.seedStr = String(seedStr);
    this.seedInt = cyrb128(this.seedStr)[0] | 0;
    this.rng = new RNG(this.seedStr);
    this.nTerrain = new Noise2D(new RNG(this.seedStr + ':terrain'));
    this.nCoast = new Noise2D(new RNG(this.seedStr + ':coast'));
    this.nMoist = new Noise2D(new RNG(this.seedStr + ':moist'));
    this.nMeadow = new Noise2D(new RNG(this.seedStr + ':meadow'));
    this.nDetail = new Noise2D(new RNG(this.seedStr + ':detail'));
    this.nRidge = new Noise2D(new RNG(this.seedStr + ':ridge'));
    const N = GRID * GRID;
    this.h = new Float32Array(N);          // terrain height (m)
    this.water = new Float32Array(N).fill(NO_WATER); // inland water surface level (lakes/rivers)
    this.riverMask = new Uint8Array(N);
    this.biome = new Uint8Array(N);
    this.road = new Uint8Array(N);         // worn path intensity 0..255
    this.gx = new Float32Array(N);         // height gradient
    this.gz = new Float32Array(N);
    this.coastDist = new Uint16Array(N);   // cells to ocean
    this.waterDist = new Uint16Array(N);   // cells to any water
    this.moist = new Float32Array(N);
    this.lakes = []; this.rivers = []; this.landmarks = []; this.paths = [];
    this.stats = {};
    this.ready = false;
  }

  // ------------------------------------------------------------ helpers
  idx(i, j) { return j * GRID + i; }
  cellX(i) { return -HALF + i * CELL; }
  cellZ(j) { return -HALF + j * CELL; }
  inGrid(i, j) { return i >= 0 && j >= 0 && i < GRID && j < GRID; }

  // bilinear coarse terrain (no detail)
  coarseHeightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GRID - 1 || j >= GRID - 1) return DEEP_OCEAN;
    const tx = fx - i, tz = fz - j;
    const h = this.h, k = j * GRID + i;
    const a = h[k], b = h[k + 1], c = h[k + GRID], d = h[k + GRID + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  // small-scale surface detail, |detail| <= ~0.8 m, by construction (visibility margins depend on it)
  detailAt(x, z) {
    return 0.55 * this.nDetail.get(x * 0.13, z * 0.13) + 0.2 * this.nDetail.get(x * 0.41 + 7.3, z * 0.41 - 2.1);
  }
  heightAt(x, z) {
    const c = this.coarseHeightAt(x, z);
    if (c <= DEEP_OCEAN + 0.01) return c;
    const w = this.waterLevelAt(x, z);
    if (c < w - 1.5) return c; // under water: no detail needed
    return c + this.detailAt(x, z);
  }
  // Water surface at a point: sea level, or a CONTINUOUS (bilinear) inland water surface.
  // Nodes of the quad without inland water take the quad max, so the surface is smooth within a quad;
  // at lake fringes the rim terrain (always above lake level) is the binding occluder, not water.
  waterLevelAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GRID - 1 || j >= GRID - 1) return SEA_LEVEL;
    const w = this.water, k = j * GRID + i;
    let a = w[k], b = w[k + 1], c = w[k + GRID], d = w[k + GRID + 1];
    let m = a > b ? a : b; if (c > m) m = c; if (d > m) m = d;
    if (m <= SEA_LEVEL) return SEA_LEVEL;
    if (a <= NO_WATER + 1) a = m; if (b <= NO_WATER + 1) b = m;
    if (c <= NO_WATER + 1) c = m; if (d <= NO_WATER + 1) d = m;
    const tx = fx - i, tz = fz - j;
    const v = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    return v > SEA_LEVEL ? v : SEA_LEVEL;
  }
  // depth of water above terrain (0 if dry)
  waterDepthAt(x, z) {
    const h = this.heightAt(x, z), w = this.waterLevelAt(x, z);
    return w > h ? w - h : 0;
  }
  biomeAt(x, z) {
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return BIOME.OCEAN;
    return this.biome[j * GRID + i];
  }
  moistAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
    return this.moist[j * GRID + i];
  }
  roadAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= GRID - 1 || j >= GRID - 1) return 0;
    const tx = fx - i, tz = fz - j, r = this.road, k = j * GRID + i;
    return ((r[k] * (1 - tx) + r[k + 1] * tx) * (1 - tz) + (r[k + GRID] * (1 - tx) + r[k + GRID + 1] * tx) * tz) / 255;
  }
  // normal-ish gradient at point (from coarse grid)
  gradAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
    const k = j * GRID + i;
    return [this.gx[k], this.gz[k]];
  }
  slopeAt(x, z) { const g = this.gradAt(x, z); return Math.hypot(g[0], g[1]); }
  coastDistAt(x, z) {
    const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
    return this.coastDist[j * GRID + i] * CELL;
  }
  isLandCell(k) { return this.h[k] >= SEA_LEVEL && this.water[k] <= SEA_LEVEL; }

  // ------------------------------------------------------------ generation pipeline
  async generate(progress) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    progress(0.02, 'Reading the seed');
    this.planGeography();
    await nextTick();
    await this.genBaseTerrain(progress);
    progress(0.42, 'Filling lakes');
    this.genLakes();
    await nextTick();
    progress(0.46, 'Tracing rivers');
    this.genRivers();
    await nextTick();
    this.guarantee = new MountainGuarantee(this);
    await this.guarantee.run((p, msg) => progress(0.5 + p * 0.36, msg));
    progress(0.87, 'Measuring slopes');
    this.computeGradients();
    this.computeDistances();
    await nextTick();
    progress(0.9, 'Growing biomes');
    this.classifyBiomes();
    await nextTick();
    progress(0.95, 'Placing landmarks and paths');
    this.genLandmarks();
    this.genPaths();
    this.classifyBiomes(true);
    this.pickSpawn();
    this.stats.genMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this.ready = true;
    progress(1, 'Ready');
  }

  planGeography() {
    const r = this.rng;
    this.center = { x: r.range(-70, 70), z: r.range(-70, 70) };
    this.islandR = r.range(860, 940);
    // dominant mountain: offset from island centre
    const a = r.range(0, TAU), d = r.range(0.06, 0.3) * this.islandR;
    this.summit = {
      x: this.center.x + Math.cos(a) * d, z: this.center.z + Math.sin(a) * d,
      h: r.range(340, 380), R: r.range(430, 500), capR: 14, dir: a,
    };
    // snap summit to a grid node so the tip is exactly representable
    const si = Math.round((this.summit.x + HALF) / CELL), sj = Math.round((this.summit.z + HALF) / CELL);
    this.summit.x = this.cellX(si); this.summit.z = this.cellZ(sj); this.summit.i = si; this.summit.j = sj;
    this.maxSecondary = this.summit.h * 0.4;
    // secondary ridge on the far side of the island
    const ra = a + Math.PI + r.range(-0.9, 0.9), rd = r.range(0.35, 0.6) * this.islandR;
    const rx = this.center.x + Math.cos(ra) * rd, rz = this.center.z + Math.sin(ra) * rd;
    const rdir = r.range(0, TAU), rl = r.range(160, 260);
    this.ridge = {
      x1: rx - Math.cos(rdir) * rl, z1: rz - Math.sin(rdir) * rl, x2: rx + Math.cos(rdir) * rl, z2: rz + Math.sin(rdir) * rl,
      h: r.range(85, 118), R: r.range(190, 260),
    };
    this.cliffPhase = r.range(0, 100);
  }

  coastRadiusAt(theta, dx, dz) {
    const n = this.nCoast;
    const ang = n.fbm(Math.cos(theta) * 1.9 + 31.7, Math.sin(theta) * 1.9 + 11.2, 3);
    const bays = n.get(dx * 0.0016 + 5.5, dz * 0.0016 + 9.1);
    return this.islandR * (0.8 + 0.2 * ang) + 110 * bays;
  }

  async genBaseTerrain(progress) {
    const nT = this.nTerrain, nR = this.nRidge, nC = this.nCoast;
    const S = this.summit, RG = this.ridge, cap = this.maxSecondary;
    const ridgeLen2 = (RG.x2 - RG.x1) ** 2 + (RG.z2 - RG.z1) ** 2;
    for (let j = 0; j < GRID; j++) {
      const z = this.cellZ(j);
      for (let i = 0; i < GRID; i++) {
        const x = this.cellX(i);
        const dx = x - this.center.x, dz = z - this.center.z;
        const rr = Math.hypot(dx, dz), theta = Math.atan2(dz, dx);
        const coastR = this.coastRadiusAt(theta, dx, dz);
        const inland = (coastR - rr) / coastR;
        let h;
        if (inland < 0) {
          h = -2 - 43 * smoothstep(0, 0.28, -inland) + 1.5 * nT.get(x * 0.01, z * 0.01);
        } else {
          const cliffy = smoothstep(0.25, 0.65, nC.fbm(Math.cos(theta) * 3.1 + this.cliffPhase, Math.sin(theta) * 3.1 + 2.5, 2) * 0.5 + 0.5);
          const beachRamp = 9 * smoothstep(0, 0.07, inland);
          const cliffRamp = 24 * smoothstep(0, 0.012, inland) + 6 * smoothstep(0.012, 0.08, inland);
          const coast = lerp(beachRamp, cliffRamp, cliffy);
          const hn = nT.fbm(x * 0.0026, z * 0.0026, 5) * 0.5 + 0.5;
          const hills = 58 * Math.pow(hn, 1.7) * smoothstep(0.03, 0.28, inland);
          const rolling = 11 * nT.fbm(x * 0.0085 + 3, z * 0.0085 - 8, 3) * smoothstep(0.02, 0.1, inland);
          let base = coast + hills + rolling + 8 * inland;
          // secondary ridge
          let t = ((x - RG.x1) * (RG.x2 - RG.x1) + (z - RG.z1) * (RG.z2 - RG.z1)) / ridgeLen2;
          t = clamp(t, 0, 1);
          const px = RG.x1 + (RG.x2 - RG.x1) * t, pz = RG.z1 + (RG.z2 - RG.z1) * t;
          const dRidge = Math.hypot(x - px, z - pz);
          if (dRidge < RG.R) {
            const f = Math.pow(1 - dRidge / RG.R, 1.6);
            const rh = RG.h * f * (0.72 + 0.28 * nR.ridged(x * 0.006, z * 0.006, 3));
            base = Math.max(base, rh + base * 0.4);
          }
          // soft cap: nothing but the dominant mountain rises above 40% of the summit
          if (base > cap * 0.75) base = cap * 0.75 + (cap * 0.25) * Math.tanh((base - cap * 0.75) / (cap * 0.25));
          h = base;
          // dominant mountain
          const dm = Math.hypot(x - S.x, z - S.z);
          if (dm < S.R) {
            const u = dm / S.R;
            let m = S.h * Math.pow(1 - u, 2.3);
            // keep the modulation gentle: a near-convex cone is visible from its own flanks, which
            // lets the visibility validator converge without carving trenches into the mountain
            const am = Math.atan2(z - S.z, x - S.x);
            const ridges = nR.fbm(Math.cos(am) * 2.6 + 50, Math.sin(am) * 2.6 + 50, 3);
            m *= 1 + 0.05 * ridges * smoothstep(0.0, 0.3, u);
            m += 2 * nT.get(x * 0.012 + 40, z * 0.012 + 40) * smoothstep(60, 150, dm);
            h = Math.max(h, m + base * 0.35);
          }
          if (dm < S.capR) h = S.h - 0.004 * dm * dm;         // summit dome
          else if (dm < S.capR + 40) h = Math.min(h, S.h - 0.8 - (dm - S.capR) * 0.6); // steep spire below the cap: keeps the tip distinct
          if (h >= S.h) h = S.h - 0.1;
        }
        this.h[j * GRID + i] = h;
      }
      if ((j & 31) === 31) { progress(0.05 + 0.35 * (j / GRID), 'Raising land from the sea'); await nextTick(); }
    }
    this.h[this.idx(S.i, S.j)] = S.h;
  }

  // ---------------------------------------------------------- lakes
  carveBasin(cx, cz, radius, noiseAmp, maxDepth, forcedLevel) {
    const n = this.nCoast;
    const ci = Math.round((cx + HALF) / CELL), cj = Math.round((cz + HALF) / CELL);
    const rc = Math.ceil((radius * (1 + noiseAmp)) / CELL) + 3;
    const rimR = (i, j) => {
      const a = Math.atan2(j - cj, i - ci);
      return radius * (1 + noiseAmp * n.fbm(Math.cos(a) * 1.5 + ci * 0.37, Math.sin(a) * 1.5 + cj * 0.37, 2));
    };
    let level;
    if (forcedLevel !== undefined) level = forcedLevel;
    else {
      level = Infinity;
      for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
        if (!this.inGrid(i, j)) continue;
        const d = Math.hypot((i - ci) * CELL, (j - cj) * CELL), r = rimR(i, j);
        if (d >= r && d < r + CELL * 1.6) level = Math.min(level, this.h[this.idx(i, j)]);
      }
      level -= 0.5;
    }
    if (!(level > SEA_LEVEL + 1.5)) return null;
    const cells = [];
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (!this.inGrid(i, j)) continue;
      const d = Math.hypot((i - ci) * CELL, (j - cj) * CELL), r = rimR(i, j);
      if (d < r) {
        const k = this.idx(i, j);
        const depth = 0.4 + maxDepth * Math.pow(1 - d / r, 0.75);
        const nh = level - depth;
        if (this.h[k] > nh) this.h[k] = nh;
        if (this.water[k] < level) this.water[k] = level;
        cells.push(k);
      }
    }
    return { x: cx, z: cz, radius, level, cells: cells.length };
  }

  genLakes() {
    const r = this.rng, S = this.summit;
    const want = r.int(3, 6);
    const lakes = [];
    for (let tries = 0; tries < 600 && lakes.length < want; tries++) {
      const i = r.int(20, GRID - 21), j = r.int(20, GRID - 21);
      const k = this.idx(i, j), h = this.h[k];
      if (h < 5 || h > 75) continue;
      const x = this.cellX(i), z = this.cellZ(j);
      if (Math.hypot(x - S.x, z - S.z) < S.R * 0.95) continue;
      // local slope using neighbours
      const sx = (this.h[k + 1] - this.h[k - 1]) / (2 * CELL), sz = (this.h[k + GRID] - this.h[k - GRID]) / (2 * CELL);
      if (Math.hypot(sx, sz) > 0.1) continue;
      // away from coast: check ring
      let ok = true;
      for (let a = 0; a < 8 && ok; a++) {
        const px = x + Math.cos(a * TAU / 8) * 110, pz = z + Math.sin(a * TAU / 8) * 110;
        if (this.coarseHeightAt(px, pz) < 2) ok = false;
      }
      if (!ok) continue;
      for (const L of lakes) if (Math.hypot(L.x - x, L.z - z) < 220) { ok = false; break; }
      if (!ok) continue;
      const lake = this.carveBasin(x, z, r.range(28, 70), 0.3, r.range(3, 7));
      if (lake) { lake.name = 'lake'; lakes.push(lake); }
    }
    this.lakes = lakes;
  }

  // ---------------------------------------------------------- rivers
  genRivers() {
    const r = this.rng, S = this.summit;
    const springs = [];
    const want = r.int(5, 8);
    for (let tries = 0; tries < 800 && springs.length < want; tries++) {
      const i = r.int(6, GRID - 7), j = r.int(6, GRID - 7);
      const k = this.idx(i, j), h = this.h[k];
      const x = this.cellX(i), z = this.cellZ(j);
      const dm = Math.hypot(x - S.x, z - S.z);
      const onMountain = dm < S.R * 0.85 && dm > 60 && h > 70 && h < 235;
      const onHills = dm >= S.R * 0.85 && h > 40 && h < 125;
      if (!onMountain && !onHills) continue;
      let ok = true;
      for (const s of springs) if (Math.hypot(s.x - x, s.z - z) < 150) { ok = false; break; }
      if (!ok) continue;
      springs.push({ i, j, x, z });
    }
    const rivers = [];
    for (const sp of springs) {
      const path = this.traceRiver(sp.i, sp.j);
      if (path && path.cells.length > 14) rivers.push(path);
    }
    for (const rv of rivers) this.carveRiver(rv);
    this.rivers = rivers;
  }

  traceRiver(i0, j0) {
    const cells = [];
    const visited = new Set();
    let i = i0, j = j0;
    let pdi = 0, pdj = 0;
    for (let step = 0; step < 700; step++) {
      const k = this.idx(i, j);
      if (visited.has(k)) break;
      visited.add(k);
      cells.push(k);
      const h = this.h[k];
      if (h < SEA_LEVEL + 0.5) return { cells, end: 'sea' };
      if (this.water[k] > NO_WATER && step > 0) return { cells, end: 'lake' };
      // choose lowest neighbour with slight momentum and deterministic jitter
      let best = -1, bestV = Infinity, bi = 0, bj = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 1 || nj < 1 || ni >= GRID - 1 || nj >= GRID - 1) continue;
        const nk = this.idx(ni, nj);
        if (visited.has(nk)) continue;
        const dist = (di && dj) ? 1.414 : 1;
        const momentum = (di * pdi + dj * pdj) * 0.35;
        const v = (this.h[nk] - h) / dist - momentum + (hash2(this.seedInt, ni, nj) - 0.5) * 0.25;
        if (v < bestV) { bestV = v; best = nk; bi = di; bj = dj; }
      }
      if (best < 0 || this.h[best] > h + 0.6) {
        // stuck in a pit: form a pond and stop
        if (cells.length > 14) {
          const pond = this.carveBasin(this.cellX(i), this.cellZ(j), 12 + Math.min(18, cells.length * 0.04), 0.25, 2.5, h + 0.6);
          if (pond) { pond.name = 'pond'; this.lakes.push(pond); }
        }
        return { cells, end: 'pond' };
      }
      pdi = bi; pdj = bj;
      i += bi; j += bj;
    }
    return { cells, end: 'long' };
  }

  carveRiver(rv) {
    const cells = rv.cells, n = cells.length;
    let wl = Infinity;
    rv.levels = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const c = cells[k], i = c % GRID, j = (c / GRID) | 0;
      const grow = Math.min(1, k / 220);
      const w = 0.55 + grow * 0.9;           // half-width in cells
      const depth = 1.1 + grow * 1.6;
      const here = this.h[c];
      let target = here - 0.35;
      if (this.water[c] > NO_WATER) target = Math.min(target, this.water[c]); // flowing into a lake
      wl = Math.min(wl, target);
      rv.levels[k] = wl;
      const rr = Math.ceil(w + 1.6);
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        const ii = i + di, jj = j + dj;
        if (!this.inGrid(ii, jj)) continue;
        const d = Math.hypot(di, dj), kk = this.idx(ii, jj);
        if (d <= w) {
          const nh = wl - depth * (1 - 0.5 * (d / w) * (d / w));
          if (this.h[kk] > nh) this.h[kk] = nh;
          if (this.water[kk] < wl) this.water[kk] = wl;
          this.riverMask[kk] = 1;
        } else if (d <= w + 2.6) {
          if (d <= w + 1.6) {
            const bank = wl + 0.9 + (d - w) * 1.8;
            if (this.h[kk] > bank) this.h[kk] = bank;
          }
          // floor: keep the water surface from hanging above adjacent dry ground (no "water walls"
          // when a river descends a steep slope) — important for the summit visibility guarantee
          const floor = wl - 1.2 - (d - w) * 2.2;
          if (this.h[kk] < floor && this.water[kk] <= NO_WATER) this.h[kk] = floor;
        }
      }
    }
  }

  // ---------------------------------------------------------- derived data
  computeGradients() {
    const h = this.h, gx = this.gx, gz = this.gz;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      const l = i > 0 ? h[k - 1] : h[k], r = i < GRID - 1 ? h[k + 1] : h[k];
      const u = j > 0 ? h[k - GRID] : h[k], d = j < GRID - 1 ? h[k + GRID] : h[k];
      gx[k] = (r - l) / (2 * CELL); gz[k] = (d - u) / (2 * CELL);
    }
  }
  bfsDistance(out, isSource) {
    out.fill(65535);
    const q = new Int32Array(GRID * GRID);
    let head = 0, tail = 0;
    for (let k = 0; k < GRID * GRID; k++) if (isSource(k)) { out[k] = 0; q[tail++] = k; }
    while (head < tail) {
      const k = q[head++], i = k % GRID, j = (k / GRID) | 0, d = out[k] + 1;
      if (i > 0 && out[k - 1] > d) { out[k - 1] = d; q[tail++] = k - 1; }
      if (i < GRID - 1 && out[k + 1] > d) { out[k + 1] = d; q[tail++] = k + 1; }
      if (j > 0 && out[k - GRID] > d) { out[k - GRID] = d; q[tail++] = k - GRID; }
      if (j < GRID - 1 && out[k + GRID] > d) { out[k + GRID] = d; q[tail++] = k + GRID; }
    }
  }
  computeDistances() {
    this.bfsDistance(this.coastDist, (k) => this.h[k] < SEA_LEVEL && this.water[k] <= NO_WATER);
    this.bfsDistance(this.waterDist, (k) => this.h[k] < SEA_LEVEL || this.water[k] > this.h[k]);
  }

  classifyBiomes(finalPass) {
    const S = this.summit, nM = this.nMoist, nE = this.nMeadow;
    let counts = new Int32Array(16);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i, h = this.h[k], x = this.cellX(i), z = this.cellZ(j);
      const slope = Math.hypot(this.gx[k], this.gz[k]);
      const wd = this.waterDist[k], cd = this.coastDist[k];
      const dm = Math.hypot(x - S.x, z - S.z);
      let m = nM.fbm(x * 0.0031, z * 0.0031, 4) * 0.9 + 0.35 * Math.exp(-wd / 7) - Math.max(0, h - 60) / 260;
      this.moist[k] = m;
      let b;
      if (this.water[k] > h) b = this.riverMask[k] ? BIOME.RIVER : BIOME.LAKE;
      else if (h < SEA_LEVEL) b = h > -7 ? BIOME.SHALLOW : BIOME.OCEAN;
      else if (dm < S.capR + 6) b = BIOME.SUMMIT;
      else if (h > S.h * 0.76) b = BIOME.SNOW;
      else if (cd <= 7 && slope > 0.62) b = BIOME.CLIFF;
      else if (cd <= 8 && h < 3.2 && slope < 0.3) b = BIOME.BEACH;
      else if (h > 150 || slope > 1.05) b = BIOME.ROCK;
      else if (slope > 0.55) b = BIOME.HILLS;
      else if (h < 4.5 && wd <= 4 && m > 0.2 && slope < 0.12) b = BIOME.MARSH;
      else if (m > 0.42) b = BIOME.DENSE_FOREST;
      else if (m > 0.1) b = BIOME.FOREST;
      else if (nE.fbm(x * 0.004 + 9, z * 0.004 + 4, 3) > 0.22 && slope < 0.3) b = BIOME.MEADOW;
      else b = BIOME.GRASS;
      if (finalPass && this.road[k] > 140 && b >= BIOME.GRASS && b !== BIOME.LAKE && b !== BIOME.RIVER) b = BIOME.PATH;
      this.biome[k] = b;
      counts[b]++;
    }
    this.stats.biomeCounts = Array.from(counts);
  }

  // ---------------------------------------------------------- landmarks
  findSite(pred, tries = 500) {
    const r = this.rng;
    for (let t = 0; t < tries; t++) {
      const i = r.int(8, GRID - 9), j = r.int(8, GRID - 9), k = this.idx(i, j);
      if (pred(k, i, j)) return { i, j, x: this.cellX(i), z: this.cellZ(j), k };
    }
    return null;
  }
  farFromLandmarks(x, z, d) {
    for (const L of this.landmarks) if (Math.hypot(L.x - x, L.z - z) < d) return false;
    return true;
  }
  genLandmarks() {
    const r = this.rng, S = this.summit;
    const flatLand = (k, i, j, maxH, maxSlope) => {
      const h = this.h[k];
      return h > 3 && h < maxH && this.water[k] <= NO_WATER && Math.hypot(this.gx[k], this.gz[k]) < maxSlope
        && this.waterDist[k] > 4 && this.coastDist[k] > 5;
    };
    const nRuins = r.int(2, 3), nVehicles = r.int(1, 2), nStones = r.int(1, 2);
    for (let n = 0; n < nRuins; n++) {
      const s = this.findSite((k, i, j) => flatLand(k, i, j, 95, 0.16) && this.farFromLandmarks(this.cellX(i), this.cellZ(j), 260));
      if (s) this.landmarks.push({ type: 'ruin', x: s.x, z: s.z, rot: r.range(0, TAU), size: r.range(9, 16), seed: r.int(0, 1e9), clear: 24, label: 'Ruins' });
    }
    for (let n = 0; n < nVehicles; n++) {
      const s = this.findSite((k, i, j) => flatLand(k, i, j, 70, 0.1) && this.farFromLandmarks(this.cellX(i), this.cellZ(j), 220));
      if (s) this.landmarks.push({ type: r.chance(0.6) ? 'bus' : 'truck', x: s.x, z: s.z, rot: r.range(0, TAU), seed: r.int(0, 1e9), clear: 10, label: 'Abandoned vehicle' });
    }
    for (let n = 0; n < nStones; n++) {
      const kind = r.pick(['stones', 'arch', 'boulders']);
      const s = this.findSite((k, i, j) => flatLand(k, i, j, 140, 0.3) && this.farFromLandmarks(this.cellX(i), this.cellZ(j), 220));
      if (s) this.landmarks.push({ type: kind, x: s.x, z: s.z, rot: r.range(0, TAU), size: r.range(8, 14), seed: r.int(0, 1e9), clear: kind === 'arch' ? 10 : 16, label: kind === 'stones' ? 'Standing stones' : kind === 'arch' ? 'Rock arch' : 'Boulder field' });
    }
    // a lone cabin ruin high on the mountain flank, rarely
    if (r.chance(0.35)) {
      const s = this.findSite((k, i, j) => {
        const x = this.cellX(i), z = this.cellZ(j), dm = Math.hypot(x - S.x, z - S.z);
        return dm > 120 && dm < S.R * 0.7 && this.h[k] > 90 && this.h[k] < 190 && Math.hypot(this.gx[k], this.gz[k]) < 0.35 && this.water[k] <= NO_WATER;
      }, 800);
      if (s) this.landmarks.push({ type: 'ruin', x: s.x, z: s.z, rot: r.range(0, TAU), size: r.range(6, 9), seed: r.int(0, 1e9), clear: 14, label: 'Hut ruin' });
    }
    this.landmarks.push({ type: 'summit', x: S.x, z: S.z, clear: 0, label: 'Summit' });
  }

  // ---------------------------------------------------------- paths (A* on downsampled grid)
  genPaths() {
    const r = this.rng;
    const step = 3, PG = Math.floor(GRID / step); // 133 x 133 nodes, 18 m apart
    const nodeK = (pi, pj) => this.idx(pi * step + 1, pj * step + 1);
    const cost = new Float32Array(PG * PG);
    for (let pj = 0; pj < PG; pj++) for (let pi = 0; pi < PG; pi++) {
      const k = nodeK(pi, pj), h = this.h[k];
      const slope = Math.hypot(this.gx[k], this.gz[k]);
      let c = 1 + slope * 14;
      if (h < 1.5 || this.water[k] > h) c = 60;         // avoid water (fordable but costly)
      if (slope > 0.9) c = 200;
      cost[pj * PG + pi] = c;
    }
    const toNode = (x, z) => [clamp(Math.round((x + HALF) / CELL / step), 0, PG - 1), clamp(Math.round((z + HALF) / CELL / step), 0, PG - 1)];
    const astar = (sx, sz, tx, tz) => {
      const open = [];
      const g = new Float32Array(PG * PG).fill(Infinity), came = new Int32Array(PG * PG).fill(-1), closed = new Uint8Array(PG * PG);
      const start = sz * PG + sx, goal = tz * PG + tx;
      g[start] = 0; open.push([Math.hypot(tx - sx, tz - sz), start]);
      let iter = 0;
      while (open.length && iter++ < 60000) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
        const cur = open[bi][1]; open[bi] = open[open.length - 1]; open.pop();
        if (cur === goal) break;
        if (closed[cur]) continue;
        closed[cur] = 1;
        const ci = cur % PG, cj = (cur / PG) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= PG || nj >= PG) continue;
          const nk = nj * PG + ni;
          if (closed[nk]) continue;
          const ng = g[cur] + ((di && dj) ? 1.414 : 1) * cost[nk];
          if (ng < g[nk]) { g[nk] = ng; came[nk] = cur; open.push([ng + Math.hypot(tx - ni, tz - nj), nk]); }
        }
      }
      if (came[goal] < 0 && goal !== start) return null;
      const pts = [];
      for (let c = goal; c >= 0; c = came[c]) { pts.push([this.cellX((c % PG) * step + 1), this.cellZ(((c / PG) | 0) * step + 1)]); if (c === start) break; }
      return pts.reverse();
    };
    const targets = this.landmarks.filter(L => L.type !== 'summit');
    const paths = [];
    for (const L of targets) {
      if (paths.length >= 3) break;
      // path from landmark toward a beach or another landmark
      let dest = null;
      const others = targets.filter(o => o !== L && Math.hypot(o.x - L.x, o.z - L.z) > 150);
      if (others.length && r.chance(0.5)) { const o = r.pick(others); dest = [o.x, o.z]; }
      else {
        // nearest beach cell in a random direction
        let best = null, bd = Infinity;
        for (let t = 0; t < 400; t++) {
          const i = r.int(5, GRID - 6), j = r.int(5, GRID - 6), k = this.idx(i, j);
          if (this.biome[k] !== BIOME.BEACH) continue;
          const d = Math.hypot(this.cellX(i) - L.x, this.cellZ(j) - L.z);
          if (d > 150 && d < bd) { bd = d; best = [this.cellX(i), this.cellZ(j)]; }
        }
        dest = best;
      }
      if (!dest) continue;
      const a = toNode(L.x, L.z), b = toNode(dest[0], dest[1]);
      const pts = astar(a[0], a[1], b[0], b[1]);
      if (pts && pts.length > 3) paths.push({ from: L.label, pts: this.smoothPolyline(pts) });
    }
    for (const p of paths) this.rasterizePath(p.pts);
    this.paths = paths;
  }
  smoothPolyline(pts) {
    let out = pts;
    for (let it = 0; it < 2; it++) {
      const n = [out[0]];
      for (let i = 0; i < out.length - 1; i++) {
        const a = out[i], b = out[i + 1];
        n.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        n.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      n.push(out[out.length - 1]);
      out = n;
    }
    return out;
  }
  rasterizePath(pts) {
    const W = 5.0;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let t = 0; t <= steps; t++) {
        const x = a[0] + (b[0] - a[0]) * t / steps, z = a[1] + (b[1] - a[1]) * t / steps;
        const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const i = ci + di, j = cj + dj;
          if (!this.inGrid(i, j)) continue;
          const d = Math.hypot(this.cellX(i) - x, this.cellZ(j) - z);
          if (d > W) continue;
          const k = this.idx(i, j);
          if (this.water[k] > this.h[k]) continue;
          const v = Math.round(255 * (1 - d / W) * 1.3);
          if (v > this.road[k]) this.road[k] = Math.min(255, v);
        }
      }
    }
  }

  // ---------------------------------------------------------- spawn
  pickSpawn() {
    const r = new RNG(this.seedStr + ':spawn');
    let best = null;
    for (let t = 0; t < 2000; t++) {
      const i = r.int(10, GRID - 11), j = r.int(10, GRID - 11), k = this.idx(i, j);
      const b = this.biome[k];
      if (b !== BIOME.BEACH && b !== BIOME.GRASS && b !== BIOME.MEADOW) continue;
      if (this.coastDist[k] > 12) continue;
      best = { x: this.cellX(i), z: this.cellZ(j) };
      break;
    }
    if (!best) {
      // fall back: any land cell
      for (let k = 0; k < GRID * GRID; k++) if (this.isLandCell(k) && this.h[k] > 2) { best = { x: this.cellX(k % GRID), z: this.cellZ((k / GRID) | 0) }; break; }
    }
    this.spawn = best || { x: this.summit.x + 200, z: this.summit.z };
    // face the summit
    this.spawn.yaw = Math.atan2(this.summit.x - this.spawn.x, this.summit.z - this.spawn.z);
  }
}
