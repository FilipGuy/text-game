/* =====================================================================
 * 50 — FIRST-PERSON ASCII RENDERER
 * A perspective terrain ray-marcher on a logical character grid. Every column marches a ray across
 * the heightfield (near → far, growing steps) and projects terrain into screen rows using a
 * classic y-buffer; objects are ASCII billboards depth-tested per cell against the terrain.
 * Terrain is ALWAYS marched to the full world extent, so the dominant mountain is never culled by
 * the object render-distance setting.
 * ===================================================================== */
const TERRAIN_MAX_DIST = 2800;   // full island diagonal — the summit is always within this

// --- glyph sets -------------------------------------------------------
const GLYPHS = {
  grass: ['.', ',', "'", '"', '`'],
  meadow: ['.', ',', '*', "'", '"'],
  sand: ['.', ',', ':', '.'],
  rock: ['#', '^', ':', '='],
  cliff: ['#', '/', '\\', '^'],
  snow: ['.', '*', ' ', "'"],
  mountain: ['^', '/', '\\', '#'],
  waterCalm: ['~', '-', '~', '='],
  waterWave: ['~', '≈', '~', '-'],
  marsh: [',', ';', '"', '~'],
  path: ['.', ':', '.', '='],
  forestFloor: ['.', ',', ';', "'"],
};
// base colors (day, neutral light)
const COLORS = {
  grass: rgb(96, 142, 70), grassDry: rgb(128, 146, 74), meadow: rgb(110, 152, 80),
  sand: rgb(196, 178, 128), rock: rgb(128, 124, 116), cliff: rgb(118, 110, 100),
  snow: rgb(228, 232, 238), water: rgb(38, 88, 128), waterDeep: rgb(18, 52, 96),
  river: rgb(52, 104, 136), marsh: rgb(86, 118, 72), path: rgb(150, 132, 100),
  trunk: rgb(104, 82, 58), conifer: rgb(48, 96, 60), leaf: rgb(84, 128, 62),
  bush: rgb(72, 112, 58), flower1: rgb(206, 180, 90), flower2: rgb(198, 120, 150),
  flower3: rgb(220, 220, 230), log: rgb(112, 90, 64), reed: rgb(120, 140, 80),
  dead: rgb(120, 108, 92), ruin: rgb(142, 136, 126), rust: rgb(142, 92, 62),
  rust2: rgb(110, 102, 96), stone: rgb(136, 132, 124),
};

// ASCII art patterns: [tiers...] each tier = { rows: ['..'], anchor: fraction of height }
// '#' style chars are mapped to colors via the type's palette function.
const PATTERNS = (() => {
  const conifer = [
    ['^', '|'],
    ['^', 'A', '|'],
    [' ^ ', '/|\\', '/|\\', ' | '],
    ['  ^  ', ' /^\\ ', '/ | \\', '/\\|/\\', '  |  '],
    ['   ^   ', '  /^\\  ', ' / | \\ ', '/\\ | /\\', ' /\\|/\\ ', '/  |  \\', '   |   '],
  ];
  const tree = [
    ['Y'],
    ['@', '|'],
    ['(@)', ' | '],
    [' @@@ ', '@@@@@', ' \\|/ ', '  |  '],
    ['  @@@  ', ' @@@@@ ', '@@@@@@@', ' @@|@@ ', '  \\|/  ', '   |   '],
  ];
  const dead = [['t'], ['Y', '|'], [' \\/', ' | ', ' | ']];
  const bush = [['*'], ['**'], ['***', '***'], [' *** ', '*****', ' *** ']];
  const rock = [[':'], ['^'], ['/\\', '##'], [' ## ', '####']];
  const flower = [['*']];
  const reed = [['|'], ['|/', '||']];
  const log = [['='], ['=='], ['====']];
  const stump = [['n'], ['[]']];
  return { conifer, tree, dead, bush, rock, flower, reed, log, stump };
})();

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cols = 0; this.rows = 0; this.cellW = 8; this.cellH = 15;
    this.ch = null; this.fg = null; this.depth = null;
    this.atlas = null; this.atlasMap = new Map(); this.atlasCursor = 0;
    this.fontPx = 14;
    this._objList = [];
    this.frame = 0;
  }

  configure(settings) {
    const w = this.canvas.width, h = this.canvas.height;
    const cols = settings.density | 0;
    this.cols = cols;
    this.cellW = w / cols;
    this.cellH = this.cellW * 1.95;
    this.rows = Math.max(10, Math.ceil(h / this.cellH));
    const n = this.cols * this.rows;
    this.ch = new Uint16Array(n);
    this.fg = new Int32Array(n);
    this.depth = new Float32Array(n);
    this.fontPx = Math.max(4, Math.floor(this.cellH * 0.94));
    this.atlasMap.clear(); this.atlasCursor = 0;
    this.atlas = null;
    this.stepQ = { low: 0.052, medium: 0.036, high: 0.026, ultra: 0.018 }[settings.quality] || 0.026;
    this.nearStep = { low: 0.8, medium: 0.6, high: 0.45, ultra: 0.35 }[settings.quality] || 0.45;
  }

  // ------------------------------------------------------------ main frame
  render(game) {
    const { world, player, settings, atmosphere: atm } = game;
    const cols = this.cols, rows = this.rows;
    if (!cols) return;
    this.frame++;
    const ch = this.ch, fg = this.fg, depth = this.depth;
    const time = game.timeSec;
    const skyCol = atm.skyColor, horizonCol = atm.horizonColor, lightRGB = atm.lightRGB, light = atm.light;
    const fogDist = atm.fogDistance;        // atmosphere/weather haze distance
    const fogCol = atm.fogColor;
    ch.fill(32); depth.fill(Infinity);

    const eyeY = player.eyeY();
    const yaw = player.yaw, pitch = player.pitch;
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const fovRad = settings.fov * Math.PI / 180;
    const focalCells = (cols / 2) / Math.tan(fovRad / 2);
    const focalRows = focalCells * (this.cellW / this.cellH);
    const horizon = rows / 2 + Math.tan(pitch) * focalRows;
    const w = world;
    const sway = atm.windPhase;

    // --- sky ---------------------------------------------------------
    for (let r = 0; r < rows; r++) {
      const tSky = clamp(r / (horizon + 0.001), 0, 1);
      const base = mixColor(skyCol, horizonCol, tSky * tSky);
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) { fg[rowOff + c] = base; }
    }
    this.drawCelestials(game, horizon, focalCells, focalRows);
    if (atm.starAlpha > 0.03) this.drawStars(game, horizon, focalCells, focalRows);
    if (atm.cloudCover > 0.05) this.drawClouds(game, horizon, focalCells, focalRows);

    // --- terrain march per column -------------------------------------
    const nearStep = this.nearStep, stepQ = this.stepQ;
    for (let c = 0; c < cols; c++) {
      const lat = (c + 0.5 - cols / 2) / focalCells;      // tan of lateral angle
      const dirX = sinY + cosY * lat, dirZ = cosY - sinY * lat;
      // note: unnormalized (planar projection) — depth t is distance along view plane normal
      let minRow = rows;             // y-buffer: lowest empty row (from bottom up)
      let t = 0.6;
      let prevSurf = -Infinity;
      while (t < TERRAIN_MAX_DIST && minRow > 0) {
        const px = player.x + dirX * t, pz = player.z + dirZ * t;
        let h;
        if (t < 140) h = w.heightAt(px, pz);
        else h = w.coarseHeightAt(px, pz);
        const wl = w.waterLevelAt(px, pz);
        const isWater = wl > h;
        const surfY = isWater ? wl : h;
        if (surfY > prevSurf - 40) { // skip projection when deep under previous silhouette? (cheap guard)
          const row = horizon + ((eyeY - surfY) / t) * focalRows;
          let rTop = Math.ceil(row);
          if (rTop < 0) rTop = 0;
          if (rTop < minRow) {
            // fill rows rTop .. minRow-1
            const fogF = 1 - Math.exp(-t / fogDist);
            for (let r = minRow - 1; r >= rTop; r--) {
              const idx = r * cols + c;
              const g = this.surfaceCell(w, px, pz, h, wl, isWater, t, time, sway, atm);
              ch[idx] = g.c;
              let col = lightColor(g.col, lightRGB, light * g.shade);
              col = mixColor(col, fogCol, fogF * 0.92);
              fg[idx] = col;
              depth[idx] = t;
            }
            minRow = rTop;
          }
        }
        prevSurf = surfY;
        t += Math.max(nearStep, t * stepQ);
      }
      // horizon haze line where sky meets unfilled terrain
    }

    // --- objects -------------------------------------------------------
    this.renderObjects(game, horizon, focalCells, focalRows, sinY, cosY, eyeY);

    // --- weather overlays ----------------------------------------------
    if (settings.weatherfx !== 'off') this.weatherOverlay(game);

    // --- blit to canvas --------------------------------------------------
    this.blit(atm);
  }

  // choose glyph + color for a terrain surface sample
  surfaceCell(w, x, z, h, wl, isWater, dist, time, sway, atm) {
    const hsh = hash2(w.seedInt, (x * 2.3) | 0, (z * 2.3) | 0);
    if (isWater) {
      const deep = clamp((wl - h) / 9, 0, 1);
      const windy = atm.windSpeed > 5 || wl <= SEA_LEVEL + 0.01;
      const set = windy ? GLYPHS.waterWave : GLYPHS.waterCalm;
      const phase = fract(hsh * 7 + time * (windy ? 1.6 : 0.8) + x * 0.07 + z * 0.05);
      const g = set[(phase * set.length) | 0];
      let col = mixColor(COLORS.water, COLORS.waterDeep, deep);
      if (wl > SEA_LEVEL + 0.01) col = COLORS.river;
      const sparkle = hsh > 0.93 && ((time * 2 + hsh * 20) % 2) < 0.4 ? 1.55 : 1;
      return { c: g.charCodeAt(0), col, shade: (0.82 + 0.3 * hsh) * sparkle };
    }
    const b = w.biomeAt(x, z);
    const slope = dist < 400 ? w.slopeAt(x, z) : 0.3;
    const road = dist < 220 ? w.roadAt(x, z) : 0;
    let set, col;
    if (road > 0.45) { set = GLYPHS.path; col = COLORS.path; }
    else switch (b) {
      case BIOME.BEACH: set = GLYPHS.sand; col = COLORS.sand; break;
      case BIOME.CLIFF: set = GLYPHS.cliff; col = COLORS.cliff; break;
      case BIOME.SNOW: case BIOME.SUMMIT: set = GLYPHS.snow; col = COLORS.snow; break;
      case BIOME.ROCK: set = h > 200 ? GLYPHS.mountain : GLYPHS.rock; col = COLORS.rock; break;
      case BIOME.HILLS: set = slope > 0.8 ? GLYPHS.rock : GLYPHS.grass; col = slope > 0.8 ? COLORS.rock : COLORS.grassDry; break;
      case BIOME.MEADOW: set = GLYPHS.meadow; col = COLORS.meadow; break;
      case BIOME.MARSH: set = GLYPHS.marsh; col = COLORS.marsh; break;
      case BIOME.DENSE_FOREST: set = GLYPHS.forestFloor; col = scaleColor(COLORS.grass, 0.8); break;
      case BIOME.FOREST: set = GLYPHS.forestFloor; col = COLORS.grass; break;
      default: set = GLYPHS.grass; col = COLORS.grass; break;
    }
    // meadow flowers tint sprinkle
    if (b === BIOME.MEADOW && hsh > 0.86) {
      col = hsh > 0.95 ? COLORS.flower2 : COLORS.flower1;
    }
    // high-altitude blending toward rock/snow on the mountain
    if (h > 150 && b !== BIOME.SNOW && b !== BIOME.SUMMIT) {
      const f = smoothstep(150, 260, h);
      col = mixColor(col, COLORS.rock, f);
      if (f > 0.5) set = GLYPHS.mountain;
      const sf = smoothstep(255, 300, h);
      if (sf > 0) col = mixColor(col, COLORS.snow, sf);
    }
    let gi = (hsh * set.length) | 0;
    // subtle wind shimmer on grass near the player
    if (dist < 60 && (b === BIOME.GRASS || b === BIOME.MEADOW) && ((sway + hsh * 6.3) % 6) < 0.5 && hsh > 0.5) gi = (gi + 1) % set.length;
    // slope shading: faces toward light slightly brighter
    const g = w.gradAt(x, z);
    const shade = clamp(0.95 - g[0] * 0.28 - g[1] * 0.1 + hsh * 0.18, 0.45, 1.3);
    return { c: set[gi].charCodeAt(0), col, shade };
  }

  // ------------------------------------------------------------ objects
  renderObjects(game, horizon, focalCells, focalRows, sinY, cosY, eyeY) {
    const { world, player, chunks, settings, atmosphere: atm } = game;
    const cols = this.cols, rows = this.rows;
    const rd = settings.renderdist;
    const list = this._objList; list.length = 0;
    const ci0 = Math.floor((player.x - rd) / CHUNK), ci1 = Math.floor((player.x + rd) / CHUNK);
    const cj0 = Math.floor((player.z - rd) / CHUNK), cj1 = Math.floor((player.z + rd) / CHUNK);
    const rd2 = rd * rd;
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      // chunk centre cull
      const ccx = (ci + 0.5) * CHUNK - player.x, ccz = (cj + 0.5) * CHUNK - player.z;
      if (ccx * ccx + ccz * ccz > (rd + CHUNK) * (rd + CHUNK)) continue;
      // frustum-ish cull: chunk behind the camera
      const fwd = ccx * sinY + ccz * cosY;
      if (fwd < -CHUNK * 1.5) continue;
      const chk = chunks.get(ci, cj);
      for (const o of chk.objects) {
        const dx = o.x - player.x, dz = o.z - player.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > rd2) continue;
        const cz = dx * sinY + dz * cosY;          // forward
        if (cz < 0.4) continue;
        const cx = dx * cosY - dz * sinY;          // right
        if (Math.abs(cx) > cz * (cols / 2 / focalCells) + 6) continue;
        list.push({ o, cz, cx, d2 });
      }
    }
    // landmark pieces
    for (const piece of game.landmarkPieces) {
      const dx = piece.x - player.x, dz = piece.z - player.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rd2 * 2.2) continue;
      const cz = dx * sinY + dz * cosY;
      if (cz < 0.4) continue;
      const cx = dx * cosY - dz * sinY;
      list.push({ o: piece, cz, cx, d2 });
    }
    // transient life (birds, butterflies, swaying extras)
    for (const o of game.transients) {
      const dx = o.x - player.x, dz = o.z - player.z;
      const d2 = dx * dx + dz * dz;
      const cz = dx * sinY + dz * cosY;
      if (cz < 0.4) continue;
      const cx = dx * cosY - dz * sinY;
      list.push({ o, cz, cx, d2 });
    }
    list.sort((a, b) => b.d2 - a.d2);  // far first
    for (const e of list) this.drawObject(game, e, horizon, focalCells, focalRows, eyeY);
  }

  patternFor(o, hRows) {
    let tiers;
    switch (o.type) {
      case OBJ.CONIFER: tiers = PATTERNS.conifer; break;
      case OBJ.TREE: tiers = PATTERNS.tree; break;
      case OBJ.DEADTREE: tiers = PATTERNS.dead; break;
      case OBJ.BUSH: tiers = PATTERNS.bush; break;
      case OBJ.ROCK: tiers = PATTERNS.rock; break;
      case OBJ.FLOWER: tiers = PATTERNS.flower; break;
      case OBJ.REED: tiers = PATTERNS.reed; break;
      case OBJ.LOG: tiers = PATTERNS.log; break;
      case OBJ.STUMP: tiers = PATTERNS.stump; break;
      default: tiers = PATTERNS.rock;
    }
    let best = tiers[0];
    for (const t of tiers) if (t.length <= hRows + 0.8) best = t; else break;
    return best;
  }

  objColor(o, cch, hsh) {
    switch (o.type) {
      case OBJ.CONIFER: return cch === 124 /* | */ ? COLORS.trunk : scaleColor(COLORS.conifer, 0.85 + 0.3 * hsh);
      case OBJ.TREE: return (cch === 124 || cch === 92 || cch === 47) ? COLORS.trunk : scaleColor(COLORS.leaf, 0.85 + 0.3 * hsh);
      case OBJ.DEADTREE: return COLORS.dead;
      case OBJ.BUSH: return scaleColor(COLORS.bush, 0.85 + 0.3 * hsh);
      case OBJ.ROCK: return scaleColor(COLORS.rock, 0.8 + 0.35 * hsh);
      case OBJ.FLOWER: return [COLORS.flower1, COLORS.flower2, COLORS.flower3][o.v % 3];
      case OBJ.REED: return COLORS.reed;
      case OBJ.LOG: return COLORS.log;
      case OBJ.STUMP: return COLORS.trunk;
      default: return COLORS.rock;
    }
  }

  drawObject(game, e, horizon, focalCells, focalRows, eyeY) {
    const o = e.o, cz = e.cz;
    const atm = game.atmosphere;
    const cols = this.cols, rows = this.rows;
    const ch = this.ch, fg = this.fg, depth = this.depth;
    const dist = Math.sqrt(e.d2);
    const fogF = 1 - Math.exp(-dist / atm.fogDistance);
    if (fogF > 0.93) return;
    const col0 = Math.round(cols / 2 + (e.cx / cz) * focalCells);
    const baseRow = horizon + ((eyeY - o.y) / cz) * focalRows;
    const hRows = (o.h / cz) * focalRows;
    if (baseRow < -4 || baseRow - hRows > rows + 4) return;

    if (o.pattern) { // landmark piece / transient with explicit pattern
      this.blitPattern(o.pattern, o.colors, col0, baseRow, hRows, cz, fogF, atm, o.swayAmt || 0, game);
      return;
    }
    const pat = this.patternFor(o, hRows);
    const hsh = o.v / 7;
    // wind sway shifts upper pattern rows laterally
    const swayCells = (game.settings.life === 'on' && (o.type === OBJ.CONIFER || o.type === OBJ.TREE || o.type === OBJ.REED))
      ? Math.sin(atm.windPhase * 1.3 + o.sway) * atm.windSway * Math.min(2, focalRows / cz * 0.35) : 0;
    const pr = pat.length;
    const rBottom = Math.round(baseRow);
    const rTop = rBottom - Math.max(1, Math.round(hRows));
    const span = rBottom - rTop;
    for (let r = Math.max(0, rTop); r < Math.min(rows, rBottom); r++) {
      const fr = span > 1 ? (r - rTop) / (span - 1) : 0;
      const prow = pat[Math.min(pr - 1, Math.round(fr * (pr - 1)))];
      const pw = prow.length;
      const swayHere = Math.round(swayCells * (1 - fr));
      for (let pc = 0; pc < pw; pc++) {
        const cch = prow.charCodeAt(pc);
        if (cch === 32) continue;
        const c = col0 + pc - (pw >> 1) + swayHere;
        if (c < 0 || c >= cols) continue;
        const idx = r * cols + c;
        if (cz >= depth[idx]) continue;      // behind terrain silhouette
        ch[idx] = cch;
        let col = this.objColor(o, cch, hsh);
        col = lightColor(col, atm.lightRGB, atm.light);
        fg[idx] = mixColor(col, atm.fogColor, fogF * 0.92);
        depth[idx] = cz;
      }
    }
  }

  blitPattern(pattern, colorFn, col0, baseRow, hRows, cz, fogF, atm, swayAmt, game) {
    const cols = this.cols, rows = this.rows;
    const ch = this.ch, fg = this.fg, depth = this.depth;
    const pr = pattern.length;
    const rBottom = Math.round(baseRow);
    const rTop = rBottom - Math.max(1, Math.round(hRows));
    const span = Math.max(1, rBottom - rTop);
    for (let r = Math.max(0, rTop); r < Math.min(rows, rBottom); r++) {
      const fr = span > 1 ? (r - rTop) / (span - 1) : 0;
      const prow = pattern[Math.min(pr - 1, Math.round(fr * (pr - 1)))];
      const pw = prow.length;
      for (let pc = 0; pc < pw; pc++) {
        const cch = prow.charCodeAt(pc);
        if (cch === 32) continue;
        const c = col0 + pc - (pw >> 1);
        if (c < 0 || c >= cols) continue;
        const idx = r * cols + c;
        if (cz >= depth[idx]) continue;
        ch[idx] = cch;
        let col = colorFn(cch, fr);
        col = lightColor(col, atm.lightRGB, atm.light);
        fg[idx] = mixColor(col, atm.fogColor, fogF * 0.92);
        depth[idx] = cz;
      }
    }
  }

  // ------------------------------------------------------------ sky details
  drawCelestials(game, horizon, focalCells, focalRows) {
    const atm = game.atmosphere, player = game.player;
    const cols = this.cols, rows = this.rows, ch = this.ch, fg = this.fg;
    for (const body of [{ az: atm.sunAz, el: atm.sunEl, glyph: 64, col: atm.sunColor, glow: true, up: atm.sunEl > -0.06 },
                        { az: atm.moonAz, el: atm.moonEl, glyph: 79, col: rgb(200, 205, 215), glow: false, up: atm.moonEl > 0 }]) {
      if (!body.up) continue;
      let rel = body.az - player.yaw;
      while (rel > Math.PI) rel -= TAU; while (rel < -Math.PI) rel += TAU;
      if (Math.abs(rel) > 1.2) continue;
      const c = Math.round(cols / 2 + Math.tan(-rel) * focalCells);
      const r = Math.round(horizon - Math.tan(body.el) * focalRows);
      if (c < -2 || c > cols + 2) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const idx = rr * cols + cc;
        const d = Math.abs(dr) + Math.abs(dc) * 0.55;
        if (d < 0.6) { ch[idx] = body.glyph; fg[idx] = body.col; }
        else if (body.glow && d < 2 && atm.cloudCover < 0.7) { fg[idx] = mixColor(fg[idx], body.col, 0.45 / d); }
      }
    }
  }

  drawStars(game, horizon, focalCells, focalRows) {
    const atm = game.atmosphere, player = game.player;
    const cols = this.cols, rows = this.rows, ch = this.ch, fg = this.fg;
    const n = Math.floor(cols * rows * 0.012 * atm.starAlpha);
    const starCol = scaleColor(rgb(210, 215, 235), clamp(atm.starAlpha, 0, 1));
    for (let i = 0; i < n; i++) {
      // fixed celestial sphere: hash by (i); azimuth/elevation
      const az = hash2(911, i, 17) * TAU, el = hash2(913, i, 29) * 0.85 + 0.03;
      let rel = az - player.yaw;
      while (rel > Math.PI) rel -= TAU; while (rel < -Math.PI) rel += TAU;
      if (Math.abs(rel) > 1.1) continue;
      const c = Math.round(cols / 2 + Math.tan(-rel) * focalCells);
      const r = Math.round(horizon - Math.tan(el) * focalRows);
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const idx = r * cols + c;
      if (ch[idx] !== 32) continue;
      ch[idx] = hash2(917, i, 3) > 0.8 ? 43 : 46; // '+' or '.'
      fg[idx] = starCol;
    }
  }

  drawClouds(game, horizon, focalCells, focalRows) {
    const atm = game.atmosphere, player = game.player;
    const cols = this.cols, ch = this.ch, fg = this.fg;
    const noise = atm.cloudNoise;
    const rowsToUse = Math.max(2, Math.floor(horizon * 0.55));
    const cover = atm.cloudCover;
    const cloudCol = lightColor(mixColor(rgb(225, 225, 228), atm.fogColor, 0.35), atm.lightRGB, clamp(atm.light * 1.05, 0.12, 1));
    const dark = scaleColor(cloudCol, 0.72);
    for (let r = 0; r < rowsToUse; r++) {
      const el = Math.atan((horizon - r) / focalRows);         // elevation of this row
      const bandY = 1 / Math.max(0.09, Math.sin(el));          // pseudo distance on cloud plane
      if (bandY > 14) continue;
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) {
        const relAng = Math.atan((c + 0.5 - cols / 2) / focalCells);
        const az = player.yaw - relAng;
        const u = Math.sin(az) * bandY + atm.cloudDrift, v = Math.cos(az) * bandY + atm.cloudDrift * 0.3;
        const nv = noise.fbm(u * 0.5, v * 0.5, 3) * 0.5 + 0.5;
        if (nv < 1 - cover * 0.85) continue;
        const idx = rowOff + c;
        if (ch[idx] !== 32) continue;
        const thick = (nv - (1 - cover * 0.85)) / (cover * 0.85 + 0.0001);
        ch[idx] = thick > 0.55 ? 64 /*@*/ : (thick > 0.3 ? 37 /*%*/ : 126 /*~*/);
        fg[idx] = mixColor(thick > 0.5 ? dark : cloudCol, fg[idx], 0.25);
      }
    }
  }

  // ------------------------------------------------------------ precipitation / fog overlay
  weatherOverlay(game) {
    const atm = game.atmosphere;
    const cols = this.cols, rows = this.rows, ch = this.ch, fg = this.fg;
    const t = game.timeSec;
    const reduced = game.settings.weatherfx === 'reduced';
    if (atm.rain > 0.02) {
      const density = atm.rain * (reduced ? 0.4 : 1) * 0.16;
      const n = Math.floor(cols * rows * density);
      const rainCol = mixColor(rgb(150, 170, 190), atm.fogColor, 0.3);
      const slant = atm.windSpeed > 9;
      const gl = slant ? 47 : 124; // '/' or '|'
      for (let i = 0; i < n; i++) {
        const seedRow = (hash2(1733, i, (t * 14 + i) | 0) * rows) | 0;
        const seedCol = (hash2(1741, i, (t * 9) | 0 + i) * cols) | 0;
        const idx = seedRow * cols + seedCol;
        if (idx >= 0 && idx < ch.length) { ch[idx] = gl; fg[idx] = rainCol; }
      }
    }
    if (atm.groundFog > 0.03 && !reduced) {
      const n = Math.floor(cols * rows * atm.groundFog * 0.05);
      const fogGl = [126, 45, 59]; // ~ - ;
      for (let i = 0; i < n; i++) {
        const r = rows - 1 - ((hash2(1747, i, (t * 0.7 + i * 3) | 0) * rows * 0.4) | 0);
        const c = ((hash2(1753, i, (t * 0.5) | 0) + Math.sin(t * 0.22 + i) * 0.08 + 1) % 1 * cols) | 0;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const idx = r * cols + c;
        ch[idx] = fogGl[i % 3];
        fg[idx] = mixColor(fg[idx], atm.fogColor, 0.75);
      }
    }
    if (atm.lightningFlash > 0.01) {
      // brighten the whole frame briefly
      const f = atm.lightningFlash;
      for (let i = 0; i < fg.length; i++) fg[i] = mixColor(fg[i], rgb(235, 238, 255), f * 0.5);
    }
  }

  // ------------------------------------------------------------ atlas blit
  ensureAtlas() {
    if (this.atlas) return;
    const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
    this.atlas = doc.createElement('canvas');
    this.tileW = Math.max(2, Math.ceil(this.cellW));
    this.tileH = Math.max(4, Math.ceil(this.cellH));
    this.atlasCols = 64;
    this.atlasRows = 64;
    this.atlas.width = this.atlasCols * this.tileW;
    this.atlas.height = this.atlasRows * this.tileH;
    this.atlasCtx = this.atlas.getContext('2d');
    this.atlasCtx.font = this.fontPx + 'px Consolas, Menlo, "DejaVu Sans Mono", monospace';
    this.atlasCtx.textBaseline = 'top';
    this.atlasCtx.textAlign = 'left';
  }

  tileFor(cch, col) {
    // quantize color to 15-bit
    const q = ((col >> 9) & 0x7c00) | ((col >> 6) & 0x3e0) | ((col >> 3) & 0x1f);
    const key = (cch << 15) | q;
    let t = this.atlasMap.get(key);
    if (t !== undefined) return t;
    if (this.atlasCursor >= this.atlasCols * this.atlasRows) { // atlas full: reset (rare)
      this.atlasMap.clear(); this.atlasCursor = 0;
      this.atlasCtx.clearRect(0, 0, this.atlas.width, this.atlas.height);
    }
    t = this.atlasCursor++;
    const ax = (t % this.atlasCols) * this.tileW, ay = ((t / this.atlasCols) | 0) * this.tileH;
    const r = (q >> 10 & 31) << 3, g = (q >> 5 & 31) << 3, b = (q & 31) << 3;
    this.atlasCtx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    this.atlasCtx.fillText(String.fromCharCode(cch), ax, ay + (this.tileH - this.fontPx) * 0.3);
    this.atlasMap.set(key, t);
    return t;
  }

  blit(atm) {
    const ctx = this.ctx, cols = this.cols, rows = this.rows;
    const ch = this.ch, fg = this.fg;
    this.ensureAtlas();
    // background: very dark version of fog/sky
    ctx.fillStyle = cssColor(scaleColor(atm.skyColor, 0.14));
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const tw = this.tileW, th = this.tileH;
    const cw = this.cellW, chh = this.cellH;
    const atlas = this.atlas, acols = this.atlasCols;
    for (let r = 0; r < rows; r++) {
      const rowOff = r * cols;
      const y = r * chh;
      for (let c = 0; c < cols; c++) {
        const cch = ch[rowOff + c];
        if (cch === 32) continue;
        const t = this.tileFor(cch, fg[rowOff + c]);
        const ax = (t % acols) * tw, ay = ((t / acols) | 0) * th;
        ctx.drawImage(atlas, ax, ay, tw, th, c * cw, y, tw, th);
      }
    }
  }
}
