/* =====================================================================
 * 80 — GAME: lifecycle, menus, settings, input, main loop
 * States: title -> loading -> playing <-> paused / map; settings overlays title or pause.
 * ===================================================================== */
const DEFAULT_SETTINGS = {
  quality: 'high', density: 160, renderdist: 420, fov: 90,
  weatherfx: 'full', life: 'on', crosshair: 'on',
  sens: 1, walk: 4.5, sprint: 8.5, inverty: 'no',
  mute: 'on', volume: 60, daylen: 12,
};
const QUALITY_PRESETS = {
  low: { density: 110, renderdist: 220 },
  medium: { density: 140, renderdist: 330 },
  high: { density: 160, renderdist: 420 },
  ultra: { density: 210, renderdist: 620 },
};

class Game {
  constructor() {
    this.state = 'title';          // title | loading | playing | paused | map | settings
    this.settingsReturn = 'title';
    this.settings = { ...DEFAULT_SETTINGS };
    this.world = null; this.player = null; this.chunks = null;
    this.renderer = null; this.map = null; this.atmosphere = null; this.wildlife = null;
    this.timeSec = 0;
    this.transients = [];
    this.landmarkPieces = [];
    this.landmarkColliders = [];
    this.pointerLocked = false;
    this._raf = null;
    this.lastT = 0;
  }

  // ---------------------------------------------------------------- boot
  boot() {
    this.cv = document.getElementById('view');
    this.cvMap = document.getElementById('mapview');
    this.renderer = new Renderer(this.cv);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindMenus();
    this.bindInput();
    AUDIO = new ProceduralAudio();
    const loop = (t) => {
      this._raf = requestAnimationFrame(loop);
      let dt = (t - this.lastT) / 1000;
      this.lastT = t;
      if (!(dt > 0) || dt > 0.25) dt = 0.016;   // tab switch / spike protection
      this.tick(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const cv of [this.cv, this.cvMap]) {
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
    }
    if (this.renderer) this.renderer.configure(this.settings);
    if (this.map) this.map.base = null;
  }

  // ---------------------------------------------------------------- menus & dom
  el(id) { return document.getElementById(id); }
  show(id) {
    for (const s of ['title', 'loading', 'pause', 'settings']) this.el(s).classList.toggle('active', s === id);
  }
  bindMenus() {
    const seedInput = this.el('seed');
    seedInput.value = '';
    this.el('btn-random').addEventListener('click', () => {
      const words = ['driftwood', 'heather', 'basalt', 'tidepool', 'fern', 'granite', 'puffin', 'moss', 'juniper', 'cairn', 'bay', 'bracken'];
      seedInput.value = words[(Math.random() * words.length) | 0] + '-' + ((Math.random() * 900 + 100) | 0);
    });
    this.el('btn-play').addEventListener('click', () => this.startGame());
    seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.startGame(); });
    this.el('btn-settings-title').addEventListener('click', () => this.openSettings('title'));
    this.el('btn-settings-pause').addEventListener('click', () => this.openSettings('pause'));
    this.el('btn-settings-back').addEventListener('click', () => this.closeSettings());
    this.el('btn-settings-defaults').addEventListener('click', () => { this.settings = { ...DEFAULT_SETTINGS }; this.syncSettingsUI(); this.applySettings(); });
    this.el('btn-resume').addEventListener('click', () => this.resume());
    this.el('btn-title').addEventListener('click', () => this.toTitle());
    // settings controls
    const bind = (id, key, isNum) => {
      const e = this.el(id);
      e.addEventListener('input', () => {
        this.settings[key] = isNum ? parseFloat(e.value) : e.value;
        if (id === 's-quality') {
          const p = QUALITY_PRESETS[e.value];
          if (p) { this.settings.density = p.density; this.settings.renderdist = p.renderdist; this.syncSettingsUI(); }
        }
        this.applySettings();
      });
    };
    bind('s-quality', 'quality'); bind('s-density', 'density', true); bind('s-renderdist', 'renderdist', true);
    bind('s-fov', 'fov', true); bind('s-weatherfx', 'weatherfx'); bind('s-life', 'life'); bind('s-crosshair', 'crosshair');
    bind('s-sens', 'sens', true); bind('s-walk', 'walk', true); bind('s-sprint', 'sprint', true); bind('s-inverty', 'inverty');
    bind('s-mute', 'mute'); bind('s-volume', 'volume', true); bind('s-daylen', 'daylen', true);
    this.syncSettingsUI();
  }
  syncSettingsUI() {
    const s = this.settings;
    const set = (id, v) => { const e = this.el(id); if (e) e.value = v; };
    set('s-quality', s.quality); set('s-density', s.density); set('s-renderdist', s.renderdist);
    set('s-fov', s.fov); set('s-weatherfx', s.weatherfx); set('s-life', s.life); set('s-crosshair', s.crosshair);
    set('s-sens', s.sens); set('s-walk', s.walk); set('s-sprint', s.sprint); set('s-inverty', s.inverty);
    set('s-mute', s.mute); set('s-volume', s.volume); set('s-daylen', s.daylen);
    this.updateSettingsVals();
  }
  updateSettingsVals() {
    const s = this.settings;
    const set = (id, v) => { const e = this.el(id); if (e) e.textContent = v; };
    set('v-density', s.density + ' col');
    set('v-renderdist', s.renderdist + ' m');
    set('v-fov', s.fov + '°');
    set('v-sens', s.sens.toFixed(1) + '×');
    set('v-walk', s.walk.toFixed(1) + ' m/s');
    set('v-sprint', s.sprint.toFixed(1) + ' m/s');
    set('v-volume', s.volume + '%');
    set('v-daylen', s.daylen + ' min');
  }
  applySettings() {
    this.updateSettingsVals();
    if (this.settings.sprint < this.settings.walk + 0.5) this.settings.sprint = this.settings.walk + 0.5;
    this.renderer.configure(this.settings);
    this.el('crosshair').style.display =
      (this.settings.crosshair === 'on' && (this.state === 'playing')) ? 'block' : 'none';
  }
  openSettings(from) {
    this.settingsReturn = from;
    this.state = 'settings';
    this.show('settings');
  }
  closeSettings() {
    if (this.settingsReturn === 'pause') { this.state = 'paused'; this.show('pause'); }
    else { this.state = 'title'; this.show('title'); }
  }

  // ---------------------------------------------------------------- flow
  async startGame() {
    const seedStr = this.el('seed').value.trim();
    const err = this.el('seed-error');
    if (!seedStr) { err.textContent = 'Please type a seed — any word or number will do.'; return; }
    if (seedStr.length > 48) { err.textContent = 'Seed is too long (48 characters max).'; return; }
    err.textContent = '';
    this.state = 'loading';
    this.show('loading');
    const fill = this.el('loadfill'), text = this.el('loadtext'), log = this.el('loadlog');
    log.textContent = '';
    const lines = [];
    const progress = (p, msg) => {
      fill.style.width = (p * 100).toFixed(1) + '%';
      if (msg && (lines.length === 0 || lines[lines.length - 1] !== msg)) {
        lines.push(msg);
        if (lines.length > 9) lines.shift();
        log.textContent = lines.join('\n');
        text.textContent = msg + '…';
      }
    };
    try {
      const world = new World(seedStr);
      await world.generate(progress);
      this.world = world;
      this.chunks = new ChunkManager(world);
      this.player = new Player(world, this.chunks);
      this.atmosphere = new Atmosphere(world);
      this.wildlife = new Wildlife(world);
      this.map = new IslandMap(this.cvMap, world);
      this.buildLandmarkPieces();
      this.timeSec = 0;
      const vis = world.stats.visibility;
      progress(1, 'Summit sightlines verified: ' + vis.verify.tested + ' positions, ' + vis.verify.violations + ' blocked');
      await new Promise(r => setTimeout(r, 450));
      this.enterPlay();
    } catch (e) {
      text.textContent = 'World generation failed: ' + e.message;
      console.error(e);
      setTimeout(() => { this.state = 'title'; this.show('title'); }, 3500);
    }
  }
  enterPlay() {
    this.state = 'playing';
    this.show('none');
    this.el('hud').style.display = 'block';
    this.el('crosshair').style.display = this.settings.crosshair === 'on' ? 'block' : 'none';
    this.cvMap.style.display = 'none';
    if (AUDIO) { AUDIO.init(); AUDIO.resume(); }
    this.requestPointer();
  }
  pause() {
    if (this.state !== 'playing' && this.state !== 'map') return;
    this.state = 'paused';
    this.cvMap.style.display = 'none';
    this.el('pause-info').textContent = 'Seed ' + this.world.seedStr + ' · position ' +
      Math.round(this.player.x) + ', ' + Math.round(this.player.z);
    this.show('pause');
    this.el('crosshair').style.display = 'none';
    document.exitPointerLock && document.exitPointerLock();
  }
  resume() {
    this.state = 'playing';
    this.show('none');
    this.el('crosshair').style.display = this.settings.crosshair === 'on' ? 'block' : 'none';
    this.requestPointer();
  }
  toTitle() {
    this.state = 'title';
    this.show('title');
    this.el('hud').style.display = 'none';
    this.el('crosshair').style.display = 'none';
    this.cvMap.style.display = 'none';
    this.world = null; this.player = null; this.chunks = null; this.map = null;
    this.landmarkPieces = []; this.landmarkColliders = []; this.transients = [];
    document.exitPointerLock && document.exitPointerLock();
  }
  toggleMap() {
    if (this.state === 'playing') {
      this.state = 'map';
      this.cvMap.style.display = 'block';
      this.el('crosshair').style.display = 'none';
    } else if (this.state === 'map') {
      this.state = 'playing';
      this.cvMap.style.display = 'none';
      this.el('crosshair').style.display = this.settings.crosshair === 'on' ? 'block' : 'none';
    }
  }

  // ---------------------------------------------------------------- input
  requestPointer() {
    if (this.cv.requestPointerLock) {
      try { const p = this.cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
    }
  }
  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.cv;
      this.el('clickhint').style.display = (!this.pointerLocked && this.state === 'playing') ? 'block' : 'none';
    });
    this.cv.addEventListener('click', () => {
      if (this.state === 'playing' && !this.pointerLocked) { this.requestPointer(); if (AUDIO) { AUDIO.init(); AUDIO.resume(); } }
    });
    document.addEventListener('mousemove', (e) => {
      if (this.state === 'playing' && this.pointerLocked && this.player) {
        this.player.look(e.movementX || 0, e.movementY || 0, this.settings.sens, this.settings.inverty === 'yes');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (this.state === 'playing' || this.state === 'map') {
        if (k === 'm') { this.toggleMap(); e.preventDefault(); return; }
        if (k === 'escape') {
          if (this.state === 'map') { this.toggleMap(); return; }
          // Esc exits pointer lock automatically; open pause
          this.pause(); return;
        }
      } else if (this.state === 'paused' && k === 'escape') { this.resume(); return; }
      else if (this.state === 'settings' && k === 'escape') { this.closeSettings(); return; }
      if (this.state !== 'playing' || !this.player) return;
      switch (k) {
        case 'w': case 'arrowup': this.player.keys.f = 1; break;
        case 's': case 'arrowdown': this.player.keys.b = 1; break;
        case 'a': case 'arrowleft': this.player.keys.l = 1; break;
        case 'd': case 'arrowright': this.player.keys.r = 1; break;
        case 'shift': this.player.keys.sprint = 1; break;
        case ' ': this.player.keys.jump = 1; e.preventDefault(); break;
      }
    });
    document.addEventListener('keyup', (e) => {
      if (!this.player) return;
      switch (e.key.toLowerCase()) {
        case 'w': case 'arrowup': this.player.keys.f = 0; break;
        case 's': case 'arrowdown': this.player.keys.b = 0; break;
        case 'a': case 'arrowleft': this.player.keys.l = 0; break;
        case 'd': case 'arrowright': this.player.keys.r = 0; break;
        case 'shift': this.player.keys.sprint = 0; break;
        case ' ': this.player.keys.jump = 0; break;
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  // ---------------------------------------------------------------- landmark construction
  buildLandmarkPieces() {
    const w = this.world;
    this.landmarkPieces = [];
    this.landmarkColliders = [];
    const pieces = this.landmarkPieces, cols = this.landmarkColliders;
    const ruinCol = (c) => c === 43 ? COLORS.stone : scaleColor(COLORS.ruin, 0.9);
    for (const L of w.landmarks) {
      const rng = new RNG(w.seedStr + ':lm:' + (L.seed || 0));
      if (L.type === 'ruin') {
        const n = Math.max(6, Math.round(L.size));
        for (let i = 0; i < n; i++) {
          const a = L.rot + (i / n) * TAU;
          if (rng.chance(0.3)) continue;  // collapsed gaps
          const rr = L.size * (0.85 + 0.15 * Math.sin(a * 3));
          const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
          const y = w.heightAt(x, z);
          const h = rng.range(1.2, 3.2);
          pieces.push({
            x, z, y, h, type: -2,
            pattern: h > 2.2 ? ['+#', '##', '##'] : ['##', '##'],
            colors: ruinCol,
          });
          cols.push({ x, z, y, h, r: 0.9 });
        }
        if (rng.chance(0.7)) { // doorway pillar pair
          const a = L.rot;
          for (const s of [-1, 1]) {
            const x = L.x + Math.cos(a) * L.size + Math.cos(a + Math.PI / 2) * s * 1.6;
            const z = L.z + Math.sin(a) * L.size + Math.sin(a + Math.PI / 2) * s * 1.6;
            const y = w.heightAt(x, z);
            pieces.push({ x, z, y, h: 3.6, type: -2, pattern: ['+', '|', '|', '#'], colors: ruinCol });
            cols.push({ x, z, y, h: 3.6, r: 0.5 });
          }
        }
      } else if (L.type === 'bus' || L.type === 'truck') {
        const y = w.heightAt(L.x, L.z);
        const bus = L.type === 'bus';
        const pat = bus ? [
          ' ________ ',
          '|[]i[]i[]|',
          '|________|',
          ' o      o ',
        ] : [
          '  ____    ',
          ' |__i_|==]',
          ' |____|__]',
          '  o    o  ',
        ];
        pieces.push({
          x: L.x, z: L.z, y, h: 3.1, type: -2, pattern: pat,
          colors: (c) => c === 111 /*o*/ ? rgb(40, 40, 42) : (c === 105 /*i*/ ? rgb(60, 70, 80) : mixColor(COLORS.rust, COLORS.rust2, hash2(1, c, L.seed) )),
        });
        cols.push({ x: L.x, z: L.z, y, h: 3.1, r: 3.6 });
      } else if (L.type === 'stones') {
        const n = Math.round(L.size * 0.6);
        for (let i = 0; i < n; i++) {
          const a = L.rot + (i / n) * TAU;
          const x = L.x + Math.cos(a) * L.size, z = L.z + Math.sin(a) * L.size;
          const y = w.heightAt(x, z);
          const h = rng.range(1.6, 3.0);
          pieces.push({ x, z, y, h, type: -2, pattern: ['n', '|', '|'], colors: () => scaleColor(COLORS.stone, 0.8 + 0.3 * (i / n)) });
          cols.push({ x, z, y, h, r: 0.55 });
        }
      } else if (L.type === 'arch') {
        const y = w.heightAt(L.x, L.z);
        pieces.push({
          x: L.x, z: L.z, y, h: 6.5, type: -2,
          pattern: ['  ___  ', ' /###\\ ', '##   ##', '##   ##', '##   ##'],
          colors: () => COLORS.cliff,
        });
        cols.push({ x: L.x - 2.2, z: L.z, y, h: 6, r: 1.1 });
        cols.push({ x: L.x + 2.2, z: L.z, y, h: 6, r: 1.1 });
      } else if (L.type === 'boulders') {
        const n = Math.round(L.size);
        for (let i = 0; i < n; i++) {
          const a = rng.range(0, TAU), d = rng.range(2, L.size * 1.4);
          const x = L.x + Math.cos(a) * d, z = L.z + Math.sin(a) * d;
          const y = w.heightAt(x, z);
          const h = rng.range(1.2, 3.4);
          pieces.push({
            x, z, y, h, type: -2,
            pattern: h > 2.4 ? [' ## ', '####', '####'] : ['##', '##'],
            colors: () => scaleColor(COLORS.rock, 0.75 + 0.4 * rng.float()),
          });
          cols.push({ x, z, y, h, r: h * 0.7 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- per-frame
  tick(dt) {
    this.timeSec += dt;
    if (this.state === 'playing' || this.state === 'map' || this.state === 'paused') {
      if (this.world && this.player) {
        if (this.state === 'playing') {
          this.player.update(dt, this.settings);
          this.atmosphere.update(dt, this.timeSec, this.settings);
          this.wildlife.update(dt, this);
          if (AUDIO) AUDIO.update(dt, this);
        }
        if (this.state === 'map') {
          this.map.draw(this.player);
          if (AUDIO) AUDIO.update(dt, this);
        } else if (this.state === 'playing') {
          this.renderer.render(this);
        }
        // paused: keep last frame
      }
    }
  }
}

const GAME = new Game();
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => GAME.boot());
  } else if (document.getElementById('view')) {
    GAME.boot();
  }
}
