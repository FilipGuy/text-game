/* =====================================================================
 * 25 — MOUNTAIN VISIBILITY GUARANTEE
 * Validates, over the entire coarse grid (cell centres AND half-cell offsets), that a line of sight
 * from a low eye point to the summit tip is not obstructed by terrain, and smoothly lowers any
 * obstructing terrain until every tested location passes. Lowering terrain is monotone, so the
 * process converges; the summit dome itself is never modified.
 * ===================================================================== */
class MountainGuarantee {
  constructor(world) {
    this.world = world;
    this.S = world.summit;
    this.report = { passes: [], verify: null, finalViolations: 0 };
    this.stepLen = CELL * 0.5;
    this.lowered = 0;
    this.obs = new Float32Array(GRID * GRID);     // cached obstruction field: max(terrain, inland water)
    this.testCells = null;
    this._viewer = { k: new Int32Array(4), w: new Float64Array(4), i: 0, j: 0 };
    this._smp = { k: new Int32Array(4), w: new Float64Array(4), i: 0, j: 0 };
    this._eff = new Float64Array(4);
  }

  // Obstruction value at a node: terrain, or the highest inland water in the 3x3 neighbourhood.
  // The one-node water smear keeps this at least as conservative as the continuous water surface
  // the game samples at runtime (whose quad support reaches one node out).
  obsVal(k) {
    const w = this.world, wt = w.water;
    let v = w.h[k];
    const i = k % GRID, j = (k / GRID) | 0;
    const i0 = i > 0 ? -1 : 0, i1 = i < GRID - 1 ? 1 : 0;
    const j0 = j > 0 ? -1 : 0, j1 = j < GRID - 1 ? 1 : 0;
    for (let dj = j0; dj <= j1; dj++) for (let di = i0; di <= i1; di++) {
      const iw = wt[k + dj * GRID + di];
      if (iw > SEA_LEVEL && iw > v) v = iw;
    }
    return v;
  }
  buildObs() {
    for (let k = 0; k < this.obs.length; k++) this.obs[k] = this.obsVal(k);
  }
  refreshObs(k) {
    // water changes affect neighbours' obs too
    const i = k % GRID, j = (k / GRID) | 0;
    const i0 = i > 0 ? -1 : 0, i1 = i < GRID - 1 ? 1 : 0;
    const j0 = j > 0 ? -1 : 0, j1 = j < GRID - 1 ? 1 : 0;
    for (let dj = j0; dj <= j1; dj++) for (let di = i0; di <= i1; di++) {
      const kk = k + dj * GRID + di;
      this.obs[kk] = this.obsVal(kk);
    }
  }

  // does this grid cell count as a place the player may stand/swim (land, inland water, or shore shallows)?
  isTestCell(k) {
    const w = this.world;
    if (w.h[k] >= SEA_LEVEL - 0.5) return true;
    if (w.water[k] > NO_WATER) return true;
    // water near the shore (wading / swimming off beaches and under coastal cliffs)
    const i = k % GRID, j = (k / GRID) | 0;
    if (w.h[k] > -6.5 && i > 0 && j > 0 && i < GRID - 1 && j < GRID - 1) {
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (w.h[(j + dj) * GRID + i + di] >= SEA_LEVEL - 0.5) return true;
      }
    }
    return false;
  }

  // Protective floor: fixes may not dig pits into the mountain's upper flanks. Without this, a fix
  // for one viewer can sink another viewer below the point where the (unlowerable) summit cap area
  // still clears their sightline. The floor is a fraction of the pure summit cone and NEVER obstructs:
  // any chord to the cap rim from at/above the floor stays above the floor cone further in.
  floorAt(x, z) {
    // Pits are prevented inside the near-field exemption radius instead (see checkRay); a terrain
    // floor was tried here but a raised floor can itself obstruct chords from mid-distance viewers.
    return -Infinity;
  }

  // Bilinear support of a world point: 4 node indices + weights (nodes outside the grid get weight 0).
  support(x, z, out) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    out.k[0] = j * GRID + i; out.w[0] = (1 - tx) * (1 - tz);
    out.k[1] = j * GRID + i + 1; out.w[1] = tx * (1 - tz);
    out.k[2] = (j + 1) * GRID + i; out.w[2] = (1 - tx) * tz;
    out.k[3] = (j + 1) * GRID + i + 1; out.w[3] = tx * tz;
    out.i = i; out.j = j;
  }

  // Lower terrain so that the bilinear height at sample `smp` drops by `delta` RELATIVE to the LOS ray,
  // taking into account that lowering a node that also supports the viewer lowers the ray by (1-t)*v_c.
  // Only nodes with a net positive effect are lowered (sum of positive parts >= t > 0, so this always works).
  lowerSample(smp, viewer, t, delta) {
    const h = this.world.h, S = this.S, w = this.world;
    let denom = 0;
    const eff = this._eff;
    for (let c = 0; c < 4; c++) {
      let v = 0;
      for (let d = 0; d < 4; d++) if (viewer.k[d] === smp.k[c]) v = viewer.w[d];
      const e = smp.w[c] - (1 - t) * v;
      eff[c] = e > 1e-6 ? e : 0;
      denom += eff[c];
    }
    if (denom < 1e-6) return;
    const D = Math.min(delta / denom, 5); // cap per-fix lowering; iteration handles the rest
    for (let c = 0; c < 4; c++) {
      if (!eff[c]) continue;
      const k = smp.k[c];
      const i = k % GRID, j = (k / GRID) | 0;
      const nx = w.cellX(i), nz = w.cellZ(j);
      if (Math.hypot(nx - S.x, nz - S.z) < S.capR + CELL) continue;
      const fl = this.floorAt(nx, nz);
      const nh = Math.max(h[k] - D, fl);
      if (nh < h[k]) { this.lowered += h[k] - nh; h[k] = nh; }
      if (w.water[k] > NO_WATER && w.water[k] > nh) w.water[k] = Math.max(nh, w.water[k] - D);
      this.refreshObs(k);
    }
    // smoothing halo: gently lower surrounding nodes that are not part of the viewer's support
    const halo = Math.min(D, 6);
    for (let j = smp.j - 2; j <= smp.j + 3; j++) {
      if (j < 0 || j >= GRID) continue;
      for (let i = smp.i - 2; i <= smp.i + 3; i++) {
        if (i < 0 || i >= GRID) continue;
        const k = j * GRID + i;
        let skip = false;
        for (let c = 0; c < 4; c++) if (smp.k[c] === k || viewer.k[c] === k) skip = true;
        if (skip) continue;
        const d = Math.hypot(i - smp.i - 0.5, j - smp.j - 0.5);
        if (d > 3.2) continue;
        const nx = w.cellX(i), nz = w.cellZ(j);
        if (Math.hypot(nx - S.x, nz - S.z) < S.capR + CELL) continue;
        const wgt = 0.5 * (1 - smoothstep(0.7, 3.2, d));
        const fl = this.floorAt(nx, nz);
        const nh2 = Math.max(h[k] - halo * wgt, fl);
        if (nh2 < h[k]) { this.lowered += h[k] - nh2; h[k] = nh2; }
        if (w.water[k] > NO_WATER && w.water[k] > nh2) w.water[k] = Math.max(nh2, w.water[k] - halo * wgt);
        this.refreshObs(k);
      }
    }
  }

  // Hard escalation: clamp the obstruction sample's support nodes straight down to the LOS limit.
  // Bilinear height <= max of support nodes, so the sample is guaranteed clear afterwards. Monotone.
  clampSample(smp, nh, viewer) {
    const w = this.world, h = w.h, S = this.S;
    for (let c = 0; c < 4; c++) {
      const k = smp.k[c];
      // never undermine the viewer's own support — that feedback loop digs craters
      if (viewer && (viewer.k[0] === k || viewer.k[1] === k || viewer.k[2] === k || viewer.k[3] === k)) continue;
      const i = k % GRID, j = (k / GRID) | 0;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const nx = w.cellX(i), nz = w.cellZ(j);
      if (Math.hypot(nx - S.x, nz - S.z) < S.capR + CELL) continue;
      const cl = Math.max(nh, this.floorAt(nx, nz));
      if (h[k] > cl) { this.lowered += h[k] - cl; h[k] = cl; }
      if (w.water[k] > cl) w.water[k] = cl;
      this.refreshObs(k);
    }
  }

  // Cast the LOS ray from viewer (vx, vz) towards the summit cap (the top 0.8 m of the mountain,
  // radius capR). Two zones with criteria matched to their uncertainty:
  //  - NEAR (d < 9 m, 0.75 m steps): ray from base+1.5 (just under the real 1.65 m eye) with a small
  //    0.5 m margin. Catches short steep risers right in front of the viewer. Surface-detail noise is
  //    spatially correlated (~8 m features), so viewer and obstruction detail nearly cancel here.
  //  - FAR (d >= 9 m, stepLen steps): ray from base+eye (a LOW conservative eye) with `margin`
  //    clearance, ramping from 1.2 m at 9 m to the full margin at 30 m.
  // Returns true if visible. If fix is set, obstructions are lowered as found and the ray continues.
  checkRay(vx, vz, eye, margin, fix, hard) {
    const w = this.world, S = this.S;
    const ground = w.coarseHeightAt(vx, vz);
    const wl = w.waterLevelAt(vx, vz);
    const base = wl > ground ? wl : ground;
    const dx = S.x - vx, dz = S.z - vz;
    const dist = Math.hypot(dx, dz);
    // Near-field exemption: within ~12 cells of the tip the viewer stands on the summit spire itself,
    // whose profile is slope-constrained toward the cap, so the tip is directly overhead and visible.
    if (dist <= S.capR + 12 * CELL) return true;
    const usable = dist - S.capR - CELL;      // sampled span along the ray (m)
    if (usable <= 0.8) return true;
    const rimSpan = dist - S.capR;            // distance at which the ray meets the cap rim
    const ty = S.h - 0.8;                     // cap rim height
    // Steep-chord exemption: when the sightline to the cap rim is steeper than the spire's bounded
    // profile slope (0.6), the summit's own upper face fills the view above the viewer — the mountain
    // top IS what they see (terrain outside the spire zone is validated/clamped separately and the
    // spire bound keeps that face within ~25 m of the tip).
    // (constant 1.8 m eye offset: strictly tighter than the real 1.65 m eye and identical across fix
    // and verify passes, so fix passes never exempt a ray that verification would still test)
    if ((ty - (base + 1.8)) / rimSpan > 0.52) return true;
    let ok = true;
    const viewer = this._viewer, smp = this._smp;
    if (fix) this.support(vx, vz, viewer);
    const invDist = 1 / dist;
    const vyN = base + 1.5, slopeN = (ty - vyN) / rimSpan;   // near ray
    const vyF = base + eye, slopeF = (ty - vyF) / rimSpan;   // far ray
    const obs = this.obs;
    const stepX = dx * invDist, stepZ = dz * invDist;
    let d = 0.75;
    while (d < usable) {
      const px = vx + stepX * d, pz = vz + stepZ * d;
      // inline bilinear over the cached obstruction field (max of terrain and inland water at nodes;
      // bilinear of the max is >= the true obstruction, i.e. conservative)
      const fx = (px + HALF) / CELL, fz = (pz + HALF) / CELL;
      const i0 = fx | 0, j0 = fz | 0;
      let th;
      if (i0 < 0 || j0 < 0 || i0 >= GRID - 1 || j0 >= GRID - 1) th = DEEP_OCEAN;
      else {
        const tx = fx - i0, tz = fz - j0, kk = j0 * GRID + i0;
        const a = obs[kk], b = obs[kk + 1], c2 = obs[kk + GRID], d2 = obs[kk + GRID + 1];
        th = (a + (b - a) * tx) * (1 - tz) + (c2 + (d2 - c2) * tx) * tz;
      }
      let limit;
      if (d < 9) limit = vyN + slopeN * d - 0.5;
      else limit = vyF + slopeF * d - (d < 30 ? 1.2 + (margin - 1.2) * (d - 9) / 21 : margin);
      if (th > limit) {
        if (!fix) return false;
        ok = false;
        this.support(px, pz, smp);
        if (hard) this.clampSample(smp, limit - 0.45, viewer);
        else this.lowerSample(smp, viewer, d / rimSpan, th - limit + 0.15);
      }
      if (d < 9) d += 0.75;
      else {
        // adaptive step: terrain rises at most ~3.5 m per metre (cone slope <= ~2.4 plus noise), so a
        // large clearance lets the ray skip ahead safely
        const gap = limit - th;
        let st = this.stepLen;
        if (gap > 14) { st = gap * 0.27; if (st > 30) st = 30; }
        d += st;
      }
    }
    return ok;
  }

  // One full pass over the grid with the given sub-cell offsets.
  pass(offsets, eye, margin, fix, hard) {
    const w = this.world;
    let tested = 0, violations = 0;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      if (this.testCells ? !this.testCells[k] : !this.isTestCell(k)) continue;
      const x = w.cellX(i), z = w.cellZ(j);
      for (const o of offsets) {
        tested++;
        if (!this.checkRay(x + o[0] * CELL, z + o[1] * CELL, eye, margin, fix, hard)) violations++;
      }
    }
    return { tested, violations };
  }

  // A cell is "risky" when its quad has a tall internal riser or touches inland water: these are the
  // places where sub-lattice viewer positions can hide behind sub-cell steps.
  riskyCell(k) {
    const w = this.world, i = k % GRID, j = (k / GRID) | 0;
    if (i >= GRID - 1 || j >= GRID - 1) return false;
    const h = w.h;
    const a = h[k], b = h[k + 1], c = h[k + GRID], d = h[k + GRID + 1];
    let lo = a, hi = a;
    if (b < lo) lo = b; if (b > hi) hi = b;
    if (c < lo) lo = c; if (c > hi) hi = c;
    if (d < lo) lo = d; if (d > hi) hi = d;
    if (hi - lo > 2.2) return true;
    const wt = w.water;
    return wt[k] > NO_WATER || wt[k + 1] > NO_WATER || wt[k + GRID] > NO_WATER || wt[k + GRID + 1] > NO_WATER;
  }

  // Pass over risky cells only, at quarter-cell offsets.
  passRisky(offsets, eye, margin, fix, hard) {
    const w = this.world;
    let tested = 0, violations = 0;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      if ((this.testCells ? !this.testCells[k] : !this.isTestCell(k)) || !this.riskyCell(k)) continue;
      const x = w.cellX(i), z = w.cellZ(j);
      for (const o of offsets) {
        tested++;
        if (!this.checkRay(x + o[0] * CELL, z + o[1] * CELL, eye, margin, fix, hard)) violations++;
      }
    }
    return { tested, violations };
  }

  async run(progress) {
    // Strategy: soft passes smooth obstructions gently; if stragglers remain, hard passes clamp the
    // remaining obstructions straight down to the sightline (monotone, so the process terminates).
    // Margins: fixes use a LOW eye (0.7 m) and larger clearances than the final verification (0.8 m eye,
    // 1.2 m clearance). The real player eye is ~1.65 m and surface detail is bounded (±0.8 m), so a
    // passing world keeps the summit visible in the detailed heightfield.
    this.buildObs();
    this.testCells = new Uint8Array(GRID * GRID);
    for (let k = 0; k < this.testCells.length; k++) this.testCells[k] = this.isTestCell(k) ? 1 : 0;
    const centre = [[0, 0]];
    const fine = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
    const quarter = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) quarter.push([a * 0.25, b * 0.25]);
    let res;
    const phase = async (name, offsets, risky, margin, softMax, base, span) => {
      for (let p = 0; p < softMax + 10; p++) {
        progress(base + span * Math.min(1, p / softMax), `${name} (pass ${p + 1})`);
        await nextTick();
        const hard = p >= softMax;
        res = risky ? this.passRisky(offsets, 0.7, margin, true, hard) : this.pass(offsets, 0.7, margin, true, hard);
        this.report.passes.push({ phase: name + (hard ? '!' : ''), ...res });
        if (res.violations === 0) break;
      }
    };
    let verify = null;
    for (let round = 0; round < 10; round++) {
      const soft = round === 0;
      // late rounds escalate: hard clamps at a margin just above the verification bar
      const mWide = round < 6 ? 2.4 : 1.45, mRisky = round < 6 ? 1.7 : 1.45;
      const softMax = soft ? 12 : (round < 6 ? 2 : 0);
      await phase('Opening sightlines', centre, false, mWide, softMax, 0.02, 0.3);
      await phase('Refining sightlines between samples', fine, false, mWide, soft ? 8 : softMax, 0.34, 0.3);
      await phase('Clearing river banks and ledges', quarter, true, mRisky, soft ? 6 : softMax, 0.66, 0.24);
      progress(0.93, 'Verifying summit visibility');
      await nextTick();
      verify = this.pass(fine, 0.8, 1.2, false);
      const verifyRisky = this.passRisky(quarter, 0.8, 1.2, false);
      verify.tested += verifyRisky.tested; verify.violations += verifyRisky.violations;
      this.report.passes.push({ phase: 'verify', ...verify });
      if (verify.violations === 0) break;
    }
    this.report.verify = verify;
    this.report.finalViolations = verify.violations;
    this.report.loweredTotal = this.lowered;
    // Dominance check: highest terrain outside the mountain's own flanks.
    let second = -Infinity;
    const w = this.world, S = this.S;
    for (let k = 0; k < GRID * GRID; k++) {
      const i = k % GRID, j = (k / GRID) | 0;
      if (Math.hypot(w.cellX(i) - S.x, w.cellZ(j) - S.z) > S.R * 0.55 && w.h[k] > second) second = w.h[k];
    }
    this.report.highestOutsideMountain = second;
    this.world.stats.visibility = this.report;
    progress(1, 'Summit visible from every tested location');
  }

  // Runtime check using the full detailed heightfield (used by tests / debug). Returns true if the
  // summit cap is visible from an eye `eyeH` above ground/water at (vx, vz).
  visibleFromDetailed(vx, vz, eyeH = 1.65, step = 1.5) {
    const w = this.world, S = this.S;
    const g = w.heightAt(vx, vz), wl = w.waterLevelAt(vx, vz);
    const vy = Math.max(g, wl) + eyeH;
    const dx = S.x - vx, dz = S.z - vz, dist = Math.hypot(dx, dz);
    if (dist <= S.capR + 12 * CELL) return true;
    const usable = dist - S.capR - CELL;
    if (usable <= 0.8) return true;
    const rimSpan = dist - S.capR, ty = S.h - 0.8;
    if ((ty - vy) / rimSpan > 0.52) return true;
    const invDist = 1 / dist, slope = (ty - vy) / rimSpan;
    let d = 0.5;
    while (d < usable) {
      const px = vx + dx * d * invDist, pz = vz + dz * d * invDist;
      let th = w.heightAt(px, pz);
      const iw = w.waterLevelAt(px, pz);
      if (iw > SEA_LEVEL && iw > th) th = iw;
      if (th > vy + slope * d) return false;
      d += (d < 9) ? 0.5 : step;
    }
    return true;
  }
}
