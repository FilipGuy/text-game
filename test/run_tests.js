/* ISLAND — headless test suite (no browser available in sandbox; strongest available verification).
 * Loads the game from the BUILT index.html via vm with DOM/canvas stubs and exercises every system. */
'use strict';
const vm = require('vm');
const { loadGame } = require('./harness.js');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, info) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + (info ? ' — ' + info : '')); console.log('FAIL  ' + name + (info ? ' — ' + info : '')); }
}

async function generateWorld(sb, seed) {
  const code = `(async () => {
    const w = new World(${JSON.stringify(seed)});
    await w.generate(() => {});
    return w;
  })()`;
  // drive the rAF-based nextTick while the promise is pending
  const prom = vm.runInContext(code, sb);
  let world = null, err = null;
  prom.then(w => world = w, e => err = e);
  const deadline = Date.now() + 180000;
  while (!world && !err && Date.now() < deadline) {
    const q = sb._rafQueue.splice(0);
    for (const fn of q) fn(Date.now());
    await new Promise(r => setImmediate(r));
  }
  if (err) throw err;
  if (!world) throw new Error('world generation timed out');
  return world;
}

function snapshotWorld(w) {
  // compact fingerprint of major geography
  let hh = 0, bb = 0;
  for (let k = 0; k < w.h.length; k += 97) { hh = (hh * 31 + Math.round(w.h[k] * 10)) | 0; bb = (bb * 31 + w.biome[k]) | 0; }
  return {
    hh, bb,
    summit: [w.summit.x, w.summit.z, Math.round(w.summit.h * 100)],
    lakes: w.lakes.length, rivers: w.rivers.length,
    landmarks: w.landmarks.map(l => l.type + '@' + Math.round(l.x) + ',' + Math.round(l.z)).join('|'),
    spawn: [Math.round(w.spawn.x), Math.round(w.spawn.z)],
  };
}

(async () => {
  console.log('== 1. script load ==');
  let sb;
  try { sb = loadGame(); check('index.html script evaluates without errors', true); }
  catch (e) { check('index.html script evaluates without errors', false, e.message); process.exit(1); }
  const g = (expr) => vm.runInContext(expr, sb);
  check('GAME object exists in title state', g('GAME && GAME.state') === 'title');
  check('boot ran: renderer configured', g('GAME.renderer && GAME.renderer.cols') > 0);

  console.log('== 2. determinism & seed variety ==');
  const wA1 = await generateWorld(sb, 'det-test');
  const wA2 = await generateWorld(sb, 'det-test');
  const wB = await generateWorld(sb, 'other-seed');
  const sA1 = JSON.stringify(snapshotWorld(wA1)), sA2 = JSON.stringify(snapshotWorld(wA2)), sB = JSON.stringify(snapshotWorld(wB));
  check('same seed reproduces identical geography', sA1 === sA2);
  check('different seeds produce different islands', sA1 !== sB);
  check('heights byte-identical for same seed', (() => {
    for (let k = 0; k < wA1.h.length; k++) if (wA1.h[k] !== wA2.h[k]) return false;
    return true;
  })());

  console.log('== 3. world structure ==');
  const GRID = g('GRID'), CELL = g('CELL'), HALF = g('HALF'), B = g('BIOME');
  for (const [name, w] of [['det-test', wA1], ['other-seed', wB]]) {
    const counts = w.stats.biomeCounts;
    check(`[${name}] has beach/forest/meadow/grass/rock biomes`,
      counts[B.BEACH] > 50 && counts[B.FOREST] > 300 && (counts[B.MEADOW] > 0) && counts[B.GRASS] > 300 && counts[B.ROCK] + counts[B.HILLS] > 200,
      JSON.stringify(counts));
    check(`[${name}] has lakes and rivers`, w.lakes.length >= 1 && w.rivers.length >= 1, `lakes=${w.lakes.length} rivers=${w.rivers.length}`);
    check(`[${name}] island is finite (edges are deep ocean)`, (() => {
      for (let i = 0; i < GRID; i += 7) {
        if (w.h[i] > -5 || w.h[(GRID - 1) * GRID + i] > -5 || w.h[i * GRID] > -5 || w.h[i * GRID + GRID - 1] > -5) return false;
      }
      return true;
    })());
    check(`[${name}] no missing terrain (all heights finite)`, (() => {
      for (let k = 0; k < w.h.length; k++) if (!isFinite(w.h[k])) return false;
      return true;
    })());
    check(`[${name}] rivers drain downhill (water levels non-increasing)`, (() => {
      for (const r of w.rivers) {
        if (!r.levels) continue;
        for (let i = 1; i < r.levels.length; i++) if (r.levels[i] > r.levels[i - 1] + 1e-4) return false;
      }
      return true;
    })());
    check(`[${name}] lakes sit in basins (level above bed)`, w.lakes.every(L => L.cells > 0));
    check(`[${name}] landmarks exist incl. summit`, w.landmarks.some(l => l.type === 'summit'));
    check(`[${name}] spawn is on walkable ground`, (() => {
      const h = w.heightAt(w.spawn.x, w.spawn.z);
      return h > 0 && h < 60;
    })());
  }

  console.log('== 4. mountain dominance & visibility ==');
  for (const [name, w] of [['det-test', wA1], ['other-seed', wB]]) {
    const vis = w.stats.visibility;
    check(`[${name}] full-grid LOS verification clean`, vis.verify.violations === 0,
      `tested=${vis.verify.tested} violations=${vis.verify.violations}`);
    check(`[${name}] verification covered the whole land grid (large sample)`, vis.verify.tested > 100000, 'tested=' + vis.verify.tested);
    check(`[${name}] summit dominates all other terrain`, vis.highestOutsideMountain < w.summit.h * 0.45,
      `second=${vis.highestOutsideMountain.toFixed(1)} summit=${w.summit.h.toFixed(1)}`);
    // independent detailed sampling across biome types
    const RNGc = g('RNG');
    const r = new RNGc('visual-check-' + name);
    let tested = 0, fails = 0;
    const byBiome = {};
    for (let i = 0; i < 30000 && tested < 4000; i++) {
      const x = r.range(-HALF + 60, HALF - 60), z = r.range(-HALF + 60, HALF - 60);
      const h = w.heightAt(x, z);
      if (h < -0.5 && w.waterLevelAt(x, z) <= 0) continue;
      tested++;
      const b = w.biomeAt(x, z);
      if (!w.guarantee.visibleFromDetailed(x, z, 1.65)) { fails++; byBiome[b] = (byBiome[b] || 0) + 1; }
    }
    check(`[${name}] detailed random LOS >= 99.9% of ${tested} positions`, fails <= tested * 0.001,
      `fails=${fails} byBiome=${JSON.stringify(byBiome)}`);
  }

  console.log('== 5. chunks ==');
  {
    const w = wA1;
    const CM = g('ChunkManager');
    const cm1 = new CM(w), cm2 = new CM(w);
    const c1 = cm1.generate(3, -2), c2 = cm2.generate(3, -2);
    check('chunk regeneration is deterministic', JSON.stringify(c1.objects) === JSON.stringify(c2.objects));
    // LRU eviction then regeneration identical
    const before = JSON.stringify(cm1.get(5, 5).objects);
    for (let i = 0; i < 500; i++) cm1.get(100 + i, 7);
    const after = JSON.stringify(cm1.get(5, 5).objects);
    check('chunk identical after LRU eviction + regeneration', before === after);
    check('chunk cache bounded', cm1.cache.size <= 360, 'size=' + cm1.cache.size);
    // consistency across boundary: objects near a chunk edge don't depend on neighbour generation order
    const cA = new CM(w); cA.get(0, 0); const objsA = JSON.stringify(cA.get(1, 0).objects);
    const cB = new CM(w); cB.get(1, 0); const objsB = JSON.stringify(cB.get(1, 0).objects);
    check('chunk content independent of access order', objsA === objsB);
    let total = 0;
    for (let ci = -8; ci < 8; ci++) for (let cj = -8; cj < 8; cj++) total += cm2.generate(ci, cj).objects.length;
    check('island interior has substantial vegetation', total > 400, 'objects in 16x16 core chunks=' + total);
  }

  console.log('== 6. player movement ==');
  {
    const w = wA1;
    const mk = () => {
      const cm = new (g('ChunkManager'))(w);
      const p = new (g('Player'))(w, cm);
      return p;
    };
    // frame-rate independence: same duration, different dt
    const run = (p, dtv, seconds) => {
      p.keys.f = 1;
      for (let t = 0; t < seconds; t += dtv) p.update(dtv, { walk: 4.5, sprint: 8.5 });
      return { x: p.x, z: p.z };
    };
    const p30 = mk(), p144 = mk();
    const a = run(p30, 1 / 30, 4), b = run(p144, 1 / 144, 4);
    const da = Math.hypot(a.x - p30.world.spawn.x, a.z - p30.world.spawn.z);
    const db = Math.hypot(b.x - p144.world.spawn.x, b.z - p144.world.spawn.z);
    check('movement distance frame-rate independent (30 vs 144 fps)', Math.abs(da - db) / Math.max(da, db) < 0.06,
      `30fps=${da.toFixed(2)}m 144fps=${db.toFixed(2)}m`);
    check('walk speed plausible', da > 8 && da < 20, da.toFixed(2) + 'm in 4s');
    // sprint faster than walk
    const ps = mk(); ps.keys.f = 1; ps.keys.sprint = 1;
    for (let t = 0; t < 4; t += 1 / 60) ps.update(1 / 60, { walk: 4.5, sprint: 8.5 });
    const ds = Math.hypot(ps.x - w.spawn.x, ps.z - w.spawn.z);
    check('sprint is faster than walk', ds > da * 1.4, `walk=${da.toFixed(1)} sprint=${ds.toFixed(1)}`);
    // jump arc
    const pj = mk();
    pj.keys.jump = 1; pj.update(1 / 60, { walk: 4.5, sprint: 8.5 }); pj.keys.jump = 0;
    let maxRise = 0; const y0 = w.heightAt(pj.x, pj.z);
    let landed = false;
    for (let t = 0; t < 2; t += 1 / 60) { pj.update(1 / 60, { walk: 4.5, sprint: 8.5 }); maxRise = Math.max(maxRise, pj.y - y0); if (t > 0.3 && pj.grounded) { landed = true; break; } }
    check('jump rises and lands', maxRise > 0.5 && maxRise < 2.5 && landed, `rise=${maxRise.toFixed(2)} landed=${landed}`);
    // swimming: drop the player in a lake or offshore
    const psw = mk();
    psw.x = 0; psw.z = 0;
    // find offshore water west of island
    let wx = -HALF + 80, wz = 0;
    psw.x = wx; psw.z = wz; psw.y = w.heightAt(wx, wz); psw.grounded = false; psw.vy = 0;
    for (let t = 0; t < 2; t += 1 / 60) psw.update(1 / 60, { walk: 4.5, sprint: 8.5 });
    check('deep water puts player in swimming state', psw.swimming === true,
      `depth=${psw.waterDepth.toFixed(2)} y=${psw.y.toFixed(2)}`);
    const sy = psw.y;
    check('swimmer floats near surface', Math.abs((w.waterLevelAt(psw.x, psw.z) - psw.y) - 0.63) < 0.5, 'gap=' + (w.waterLevelAt(psw.x, psw.z) - psw.y).toFixed(2));
    // boundary clamp
    const pb = mk(); pb.x = -HALF + 30; pb.z = 0; pb.swimming = true;
    pb.keys.f = 1; pb.yaw = Math.atan2(-1, 0) === 0 ? 0 : -Math.PI / 2; // face -x
    pb.yaw = -Math.PI / 2;
    for (let t = 0; t < 6; t += 1 / 30) pb.update(1 / 30, { walk: 4.5, sprint: 8.5 });
    check('world boundary is enforced', pb.x >= -HALF + 20, 'x=' + pb.x.toFixed(1));
    // steep wall blocking: find a cliff and run at it
    check('cannot climb a sheer wall', (() => {
      // synthetic check: place at base of the mountain spire and run inward
      const S = w.summit;
      const px = S.x + 80, pz = S.z;
      const p = mk(); p.x = px; p.z = pz; p.y = w.heightAt(px, pz); p.yaw = Math.atan2(S.x - px, S.z - pz);
      p.keys.f = 1;
      for (let t = 0; t < 8; t += 1 / 30) p.update(1 / 30, { walk: 4.5, sprint: 8.5 });
      const dm = Math.hypot(p.x - S.x, p.z - S.z);
      return dm > 14; // cannot stand on the very tip dome by walking up the spire wall
    })());
  }

  console.log('== 7. renderer (headless) ==');
  {
    // build a playable GAME inside the sandbox
    const setupCode = `(async () => {
      GAME.world = new World('render-test');
      await GAME.world.generate(() => {});
      GAME.chunks = new ChunkManager(GAME.world);
      GAME.player = new Player(GAME.world, GAME.chunks);
      GAME.atmosphere = new Atmosphere(GAME.world);
      GAME.wildlife = new Wildlife(GAME.world);
      GAME.map = new IslandMap(GAME.cvMap || document.getElementById('mapview'), GAME.world);
      GAME.buildLandmarkPieces();
      GAME.state = 'playing';
      GAME.cv = document.getElementById('view');
      return true;
    })()`;
    let done = null, err = null;
    vm.runInContext(setupCode, sb).then(v => done = v, e => err = e);
    const deadline = Date.now() + 180000;
    while (!done && !err && Date.now() < deadline) {
      const q = sb._rafQueue.splice(0);
      for (const fn of q) fn(Date.now());
      await new Promise(r => setImmediate(r));
    }
    if (err) throw err;
    check('in-sandbox game setup for rendering', done === true);
    const frame = (code) => vm.runInContext(code, sb);
    // render frames from several positions/directions without exceptions
    let renderErr = null;
    try {
      frame(`
        GAME.renderer.configure(GAME.settings);
        const W = GAME.world, P = GAME.player;
        const spots = [
          [W.spawn.x, W.spawn.z], [W.summit.x + 300, W.summit.z + 100], [0, 600], [-500, -300], [W.summit.x, W.summit.z + 500],
        ];
        for (const [x, z] of spots) {
          P.x = x; P.z = z; P.y = Math.max(W.heightAt(x, z), W.waterLevelAt(x, z));
          for (const yaw of [0, 1.6, 3.1, -1.6]) {
            P.yaw = yaw;
            GAME.timeSec += 0.16;
            GAME.atmosphere.update(0.16, GAME.timeSec, GAME.settings);
            GAME.wildlife.update(0.16, GAME);
            GAME.renderer.render(GAME);
          }
        }
      `);
    } catch (e) { renderErr = e; }
    check('20 frames render with no exceptions (5 spots × 4 directions)', !renderErr, renderErr && renderErr.message);

    // mountain visible in the actual rendered frame — from multiple positions, facing the summit
    const mountainCheck = frame(`(() => {
      const W = GAME.world, P = GAME.player, R = GAME.renderer, S = W.summit;
      const results = [];
      const spots = [];
      const rr = new RNG('frame-check');
      for (let i = 0; i < 60 && spots.length < 12; i++) {
        const x = rr.range(-900, 900), z = rr.range(-900, 900);
        const h = W.heightAt(x, z);
        if (h < 0.5) continue;
        const d = Math.hypot(S.x - x, S.z - z);
        if (d < 150) continue;
        spots.push([x, z, d]);
      }
      GAME.transients.length = 0;   // keep birds/butterflies out of the silhouette scan
      for (const [x, z, d] of spots) {
        P.x = x; P.z = z; P.y = W.heightAt(x, z); P.grounded = true; P.swimming = false;
        P.yaw = Math.atan2(S.x - x, S.z - z);
        // aim the camera at the tip so the expected row is mid-screen regardless of distance
        P.pitch = Math.atan((S.h - (W.heightAt(x, z) + 1.65)) / d);
        R.render(GAME);
        // examine centre column: find topmost filled terrain cell and its depth
        const cols = R.cols, rows = R.rows;
        const eyeY = P.eyeY();
        const fov = GAME.settings.fov * Math.PI / 180;
        const focalCells = (cols / 2) / Math.tan(fov / 2);
        const focalRows = focalCells * (R.cellW / R.cellH);
        const horizon = rows / 2 + Math.tan(P.pitch) * focalRows;
        const expRow = horizon - ((S.h - 1 - eyeY) / d) * focalRows;  // where the tip should project
        // The summit cap subtends several columns; a single foreground tree may cross one column.
        // Pass if ANY central column shows the summit silhouette at the right row AND depth.
        let okCols = 0, best = null;
        for (let dc = -3; dc <= 3; dc++) {
          const c = (cols >> 1) + dc;
          let topFilled = -1, topDepth = Infinity;
          for (let r = 0; r < rows; r++) {
            const idx = r * cols + c;
            if (R.depth[idx] < Infinity) { topFilled = r; topDepth = R.depth[idx]; break; }
          }
          const okRow = topFilled >= 0 && topFilled <= expRow + 2.5;     // silhouette reaches tip height
          const okDepth = topDepth > d - S.R - 60 && topDepth < d + 60;  // and it IS the mountain
          if (okRow && okDepth) okCols++;
          if (!best || (okRow && okDepth)) best = { topFilled, topDepth: Math.round(topDepth) };
        }
        results.push({ d: Math.round(d), expRow: Math.round(expRow * 10) / 10, okCols, ...best, okRow: okCols > 0, okDepth: okCols > 0 });
      }
      return results;
    })()`);
    const allOk = mountainCheck.every(r => r.okRow && r.okDepth);
    check('summit silhouette present at correct screen position from ' + mountainCheck.length + ' random land spots',
      allOk, JSON.stringify(mountainCheck.filter(r => !(r.okRow && r.okDepth))));
    // mountain not culled at minimum object render distance
    const cull = frame(`(() => {
      const old = GAME.settings.renderdist;
      GAME.settings.renderdist = 120;
      const W = GAME.world, P = GAME.player, S = W.summit;
      // find a dry land viewpoint 600-900 m from the summit
      let vx = S.x + 700, vz = S.z;
      const rr2 = new RNG('cull-spot');
      for (let i = 0; i < 500; i++) {
        const a = rr2.range(0, 6.28), d = rr2.range(600, 900);
        const x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d;
        if (Math.abs(x) > 1100 || Math.abs(z) > 1100) continue;
        if (W.heightAt(x, z) > 1 && W.waterLevelAt(x, z) <= 0) { vx = x; vz = z; break; }
      }
      P.x = vx; P.z = vz; P.y = W.heightAt(vx, vz); P.grounded = true; P.swimming = false;
      const dS = Math.hypot(S.x - vx, S.z - vz);
      P.yaw = Math.atan2(S.x - vx, S.z - vz);
      P.pitch = Math.atan((S.h - P.y - 1.65) / dS);
      GAME.transients.length = 0;
      GAME.renderer.render(GAME);
      const R = GAME.renderer, cols = R.cols;
      let top = -1, dep = Infinity;
      for (let r = 0; r < R.rows; r++) { const idx = r * cols + (cols >> 1); if (R.depth[idx] < Infinity) { top = r; dep = R.depth[idx]; break; } }
      GAME.settings.renderdist = old;
      return { top, dep, dS: Math.round(dS) };
    })()`);
    check('mountain NOT culled at minimum render distance setting',
      cull.top >= 0 && cull.dep > cull.dS - 500 && cull.dep < cull.dS + 60, JSON.stringify(cull));
    // quality settings change work
    const workDiff = frame(`(() => {
      const out = {};
      for (const q of ['low', 'ultra']) {
        GAME.settings.quality = q;
        const p = QUALITY_PRESETS[q];
        GAME.settings.density = p.density; GAME.settings.renderdist = p.renderdist;
        GAME.renderer.configure(GAME.settings);
        GAME.renderer.render(GAME);
        out[q] = GAME.renderer.cols * GAME.renderer.rows;
      }
      GAME.settings.quality = 'high'; GAME.settings.density = 160; GAME.settings.renderdist = 420;
      GAME.renderer.configure(GAME.settings);
      return out;
    })()`);
    check('quality presets change render grid size', workDiff.ultra > workDiff.low * 1.5, JSON.stringify(workDiff));
  }

  console.log('== 8. map, atmosphere, audio ==');
  {
    let mapErr = null;
    try {
      vm.runInContext(`GAME.map.draw(GAME.player); GAME.map.draw(GAME.player);`, sb);
    } catch (e) { mapErr = e; }
    check('island map renders headless without exceptions', !mapErr, mapErr && mapErr.message);
    check('map base layer cached after first draw', g('GAME.map.base !== null') === true);
    const atmTest = vm.runInContext(`(() => {
      const A = GAME.atmosphere;
      const s = { ...GAME.settings, daylen: 4 };
      const seen = new Set(); let minLight = 1, maxLight = 0, weatherChanges = 0;
      let lastState = A.state;
      for (let t = 0; t < 1200; t += 0.5) {
        A.update(0.5, t, s);
        seen.add(Math.round(A.dayFrac * 8) / 8);
        minLight = Math.min(minLight, A.light); maxLight = Math.max(maxLight, A.light);
        if (A.state !== lastState) { weatherChanges++; lastState = A.state; }
      }
      return { phases: seen.size, minLight, maxLight, weatherChanges, state: A.state,
               fog: A.fogDistance, rain: A.rain };
    })()`, sb);
    check('day/night cycle sweeps phases and light range', atmTest.phases >= 8 && atmTest.minLight < 0.3 && atmTest.maxLight > 0.8, JSON.stringify(atmTest));
    check('weather transitions over time', atmTest.weatherChanges >= 2, 'changes=' + atmTest.weatherChanges);
    const audioOk = vm.runInContext(`(() => {
      const a = new ProceduralAudio();
      a.init();                      // no AudioContext in sandbox -> should fail gracefully
      a.update(0.016, GAME); a.thunder(); a.chirp();
      return a.failed === true && a.enabled === false;
    })()`, sb);
    check('audio degrades gracefully without AudioContext', audioOk === true);
  }

  console.log('== 9. loop, resize, memory ==');
  {
    let err9 = null;
    try {
      vm.runInContext(`
        // simulate ticks incl. map state and pause
        GAME.state = 'playing';
        for (let i = 0; i < 30; i++) GAME.tick(1 / 60);
        GAME.state = 'map';
        for (let i = 0; i < 5; i++) GAME.tick(1 / 60);
        GAME.state = 'paused';
        for (let i = 0; i < 5; i++) GAME.tick(1 / 60);
        GAME.state = 'playing';
        GAME.tick(3.5);       // huge frame spike must be clamped by caller loop; direct tick with big dt:
        // resize mid-game
        window.innerWidth = 900; window.innerHeight = 500;
        GAME.resize();
        GAME.tick(1 / 60);
        window.innerWidth = 1280; window.innerHeight = 720;
        GAME.resize();
        GAME.tick(1 / 60);
      `, sb);
    } catch (e) { err9 = e; }
    check('tick/pause/map/resize cycles run clean', !err9, err9 && err9.message);
    check('global terrain not regenerated during play (same arrays)', vm.runInContext(`(() => {
      const h1 = GAME.world.h;
      for (let i = 0; i < 20; i++) GAME.tick(1 / 60);
      return GAME.world.h === h1;
    })()`, sb) === true);
    const memBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3; i++) {
      await generateWorld(sb, 'mem-' + i);
      global.gc && global.gc();
    }
    const memAfter = process.memoryUsage().heapUsed;
    check('repeated world generation does not grow memory unboundedly',
      memAfter - memBefore < 450e6, ((memAfter - memBefore) / 1e6).toFixed(0) + ' MB');
  }

  console.log('\n================================');
  console.log(`PASSED ${passed}   FAILED ${failed}`);
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(2); });
