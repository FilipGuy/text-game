/* =====================================================================
 * 70 — ATMOSPHERE: day/night cycle, weather state machine, living nature, procedural audio
 * ===================================================================== */
class Atmosphere {
  constructor(world) {
    this.world = world;
    this.rng = new RNG(world.seedStr + ':weather');
    this.cloudNoise = new Noise2D(new RNG(world.seedStr + ':clouds'));
    this.dayFrac = 0.32;             // start mid-morning
    // weather state machine
    this.states = ['clear', 'haze', 'clouds', 'fog', 'rain', 'heavy', 'storm'];
    this.state = 'clear';
    this.stateTime = 0;
    this.stateDur = this.rng.range(80, 150);
    // smooth parameters (current, target)
    this.p = { fog: 0.06, rain: 0, cloud: 0.22, wind: 3.5 };
    this.t = { ...this.p };
    this.applyStateTargets();
    Object.assign(this.p, this.t);
    this.windPhase = 0;
    this.cloudDrift = 0;
    this.lightningFlash = 0;
    this.lightningCooldown = 10;
    this.thunderQueued = 0;
    // outputs
    this.light = 1; this.lightRGB = rgb(255, 255, 255);
    this.skyColor = rgb(110, 160, 210); this.horizonColor = rgb(190, 205, 215);
    this.fogColor = rgb(170, 185, 200); this.fogDistance = 1500;
    this.sunAz = 0; this.sunEl = 0.5; this.moonAz = 0; this.moonEl = -0.5;
    this.sunColor = rgb(255, 240, 180);
    this.starAlpha = 0; this.cloudCover = 0.2; this.windSpeed = 3.5; this.windSway = 0.3;
    this.rain = 0; this.groundFog = 0;
  }

  transitionWeights() {
    switch (this.state) {
      case 'clear': return { clear: 3, haze: 2, clouds: 3, fog: 0.6, rain: 0.5 };
      case 'haze': return { clear: 3, haze: 1, clouds: 2, fog: 1.5, rain: 0.6 };
      case 'clouds': return { clear: 2, haze: 1, clouds: 2, rain: 2.4, fog: 0.8 };
      case 'fog': return { haze: 2, fog: 1.5, clear: 1.5, clouds: 1, rain: 0.7 };
      case 'rain': return { clouds: 2.4, rain: 1.4, heavy: 1.2, haze: 0.8 };
      case 'heavy': return { rain: 2.2, storm: 1.4, heavy: 0.8, clouds: 0.9 };
      case 'storm': return { heavy: 2.5, rain: 1.6, clouds: 0.7 };
      default: return { clear: 1 };
    }
  }
  applyStateTargets() {
    const t = this.t, r = this.rng;
    switch (this.state) {
      case 'clear': t.fog = r.range(0.02, 0.1); t.rain = 0; t.cloud = r.range(0.05, 0.3); t.wind = r.range(1.5, 5); break;
      case 'haze': t.fog = r.range(0.18, 0.34); t.rain = 0; t.cloud = r.range(0.2, 0.5); t.wind = r.range(1, 4); break;
      case 'clouds': t.fog = r.range(0.08, 0.2); t.rain = 0; t.cloud = r.range(0.55, 0.85); t.wind = r.range(3, 8); break;
      case 'fog': t.fog = r.range(0.55, 0.9); t.rain = 0; t.cloud = r.range(0.4, 0.8); t.wind = r.range(0.5, 2.5); break;
      case 'rain': t.fog = r.range(0.3, 0.45); t.rain = r.range(0.25, 0.5); t.cloud = r.range(0.75, 0.95); t.wind = r.range(4, 9); break;
      case 'heavy': t.fog = r.range(0.45, 0.6); t.rain = r.range(0.65, 0.9); t.cloud = 1; t.wind = r.range(7, 13); break;
      case 'storm': t.fog = r.range(0.5, 0.7); t.rain = 1; t.cloud = 1; t.wind = r.range(11, 17); break;
    }
  }

  update(dt, timeSec, settings) {
    // --- day/night ---
    const dayLen = settings.daylen * 60;
    this.dayFrac = (this.dayFrac + dt / dayLen) % 1;
    const d = this.dayFrac;
    // sun elevation: -1..1 sine; day from 0.25..0.75 roughly
    const sunEl = Math.sin((d - 0.25) * TAU) * 1.05;
    this.sunEl = Math.asin(clamp(sunEl, -1, 1)) * 0.9;
    this.sunAz = (d * TAU * 1) + Math.PI;    // sweeps around
    this.moonAz = this.sunAz + Math.PI;
    this.moonEl = -this.sunEl * 0.8;

    // weather evolution
    if (settings.weatherfx === 'off') {
      this.t.fog = 0.05; this.t.rain = 0; this.t.cloud = 0.15; this.t.wind = 2.5;
    } else {
      this.stateTime += dt;
      if (this.stateTime > this.stateDur) {
        this.stateTime = 0;
        this.stateDur = this.rng.range(70, 160);
        const w = this.transitionWeights();
        let sum = 0; for (const k in w) sum += w[k];
        let pick = this.rng.float() * sum;
        for (const k in w) { pick -= w[k]; if (pick <= 0) { this.state = k; break; } }
        this.applyStateTargets();
      }
    }
    const blend = 1 - Math.exp(-dt / 14);   // slow smooth transitions
    this.p.fog += (this.t.fog - this.p.fog) * blend;
    this.p.rain += (this.t.rain - this.p.rain) * blend;
    this.p.cloud += (this.t.cloud - this.p.cloud) * blend;
    this.p.wind += (this.t.wind - this.p.wind) * blend;

    this.windPhase += dt * (0.6 + this.p.wind * 0.14);
    this.cloudDrift += dt * (0.01 + this.p.wind * 0.004);
    this.windSpeed = this.p.wind;
    this.windSway = clamp(this.p.wind / 11, 0.08, 1.3);
    this.rain = this.p.rain;
    this.cloudCover = this.p.cloud;
    this.groundFog = this.p.fog * (this.state === 'fog' ? 1 : 0.4);

    // lightning
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 2.6);
    if (this.state === 'storm') {
      this.lightningCooldown -= dt;
      if (this.lightningCooldown <= 0) {
        this.lightningFlash = 1;
        this.thunderQueued = this.rng.range(0.4, 2.2);  // audio delay
        this.lightningCooldown = this.rng.range(4, 14);
      }
    }
    if (this.thunderQueued > 0) {
      this.thunderQueued -= dt;
      if (this.thunderQueued <= 0 && typeof AUDIO !== 'undefined' && AUDIO) AUDIO.thunder();
    }

    // --- lighting from sun elevation ---
    const sel = this.sunEl;
    const dayness = smoothstep(-0.14, 0.12, sel);
    const dusk = Math.exp(-Math.pow((sel - 0.02) * 7, 2));   // golden factor around sunrise/sunset
    this.light = lerp(0.16, 1.0, dayness) * lerp(1, 0.72, this.p.cloud * 0.8) * lerp(1, 0.8, this.p.fog);
    const dayRGB = rgb(255, 252, 244), duskRGB = rgb(255, 176, 120), nightRGB = rgb(96, 116, 170);
    let lrgb = mixColor(nightRGB, dayRGB, dayness);
    lrgb = mixColor(lrgb, duskRGB, dusk * 0.65);
    this.lightRGB = lrgb;
    this.sunColor = mixColor(rgb(255, 244, 200), rgb(255, 140, 70), dusk);
    // sky colors
    const skyDay = rgb(104, 156, 208), skyNight = rgb(10, 14, 30), skyDusk = rgb(190, 110, 80);
    const horDay = rgb(185, 205, 220), horNight = rgb(20, 24, 42), horDusk = rgb(235, 160, 100);
    let sky = mixColor(skyNight, skyDay, dayness); sky = mixColor(sky, skyDusk, dusk * 0.55);
    let hor = mixColor(horNight, horDay, dayness); hor = mixColor(hor, horDusk, dusk * 0.75);
    sky = mixColor(sky, scaleColor(rgb(120, 128, 140), this.light), this.p.cloud * 0.55);
    hor = mixColor(hor, scaleColor(rgb(140, 146, 155), this.light), this.p.cloud * 0.5);
    this.skyColor = sky; this.horizonColor = hor;
    this.starAlpha = clamp((1 - dayness) - this.p.cloud * 0.8 - this.p.fog, 0, 1);
    // fog
    const clearDist = 2600;
    this.fogDistance = lerp(clearDist, 110, Math.pow(this.p.fog, 1.35));
    if (this.p.rain > 0.4) this.fogDistance = Math.min(this.fogDistance, lerp(900, 380, this.p.rain));
    let fogc = mixColor(hor, scaleColor(rgb(150, 158, 168), Math.max(0.25, this.light)), 0.5);
    this.fogColor = fogc;
  }
}

/* ------------------------------------------------------------------ living nature */
class Wildlife {
  constructor(world, rng) {
    this.world = world;
    this.rng = new RNG(world.seedStr + ':life');
    this.birds = [];
    this.butterflies = [];
  }
  update(dt, game) {
    const p = game.player, atm = game.atmosphere;
    if (game.settings.life !== 'on') { this.birds.length = 0; this.butterflies.length = 0; return; }
    const day = atm.sunEl > 0;
    // --- birds: distant gliders, never approach the player ---
    if (day && atm.rain < 0.3 && this.birds.length < 4 && this.rng.chance(dt * 0.08)) {
      const a = this.rng.range(0, TAU), d = this.rng.range(90, 300);
      this.birds.push({
        x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d,
        y: 0, alt: this.rng.range(18, 55),
        dir: this.rng.range(0, TAU), speed: this.rng.range(6, 11),
        life: this.rng.range(25, 60), flap: this.rng.range(0, TAU),
      });
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      b.life -= dt;
      b.flap += dt * 7;
      b.dir += Math.sin(b.flap * 0.11 + i) * dt * 0.35;
      b.x += Math.cos(b.dir) * b.speed * dt;
      b.z += Math.sin(b.dir) * b.speed * dt;
      const g = Math.max(this.world.heightAt(b.x, b.z), this.world.waterLevelAt(b.x, b.z));
      b.y = g + b.alt + Math.sin(b.flap * 0.23) * 3;
      const dd = Math.hypot(b.x - p.x, b.z - p.z);
      if (b.life < 0 || dd > 500) this.birds.splice(i, 1);
      else if (dd < 30) { b.dir = Math.atan2(b.z - p.z, b.x - p.x); } // drift away, never at player
    }
    // --- butterflies in meadows near the player ---
    const b0 = this.world.biomeAt(p.x, p.z);
    if (day && atm.rain < 0.1 && this.butterflies.length < 6 &&
        (b0 === BIOME.MEADOW || b0 === BIOME.GRASS) && this.rng.chance(dt * 0.5)) {
      const a = this.rng.range(0, TAU), d = this.rng.range(4, 20);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (this.world.biomeAt(x, z) === BIOME.MEADOW || this.world.biomeAt(x, z) === BIOME.GRASS) {
        this.butterflies.push({ x, z, y: 0, ph: this.rng.range(0, TAU), life: this.rng.range(14, 30), v: this.rng.int(0, 2) });
      }
    }
    for (let i = this.butterflies.length - 1; i >= 0; i--) {
      const f = this.butterflies[i];
      f.life -= dt; f.ph += dt * 3;
      f.x += Math.cos(f.ph * 1.7) * dt * 1.2;
      f.z += Math.sin(f.ph * 1.3) * dt * 1.2;
      f.y = this.world.heightAt(f.x, f.z) + 0.9 + Math.sin(f.ph * 2.1) * 0.4;
      if (f.life < 0 || Math.hypot(f.x - p.x, f.z - p.z) > 60) this.butterflies.splice(i, 1);
    }
    // publish as transient renderables
    const tr = game.transients; tr.length = 0;
    for (const b of this.birds) {
      const flapUp = Math.sin(b.flap) > 0;
      tr.push({
        x: b.x, z: b.z, y: b.y, h: 1.2, type: -1,
        pattern: [flapUp ? '\\v/' : '-v-'],
        colors: () => rgb(40, 42, 48),
      });
    }
    for (const f of this.butterflies) {
      tr.push({
        x: f.x, z: f.z, y: f.y, h: 0.5, type: -1,
        pattern: [Math.sin(f.ph * 4) > 0 ? '}{' : ')('],
        colors: () => [rgb(220, 190, 90), rgb(210, 140, 170), rgb(225, 225, 235)][f.v],
      });
    }
  }
}

/* ------------------------------------------------------------------ procedural audio */
class ProceduralAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.master = null;
    this.nodes = {};
    this.failed = false;
  }
  // must be called from a user gesture
  init() {
    if (this.ctx || this.failed) return;
    try {
      const AC = typeof AudioContext !== 'undefined' ? AudioContext :
        (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
      if (!AC) { this.failed = true; return; }
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      // shared noise buffer (2 s white noise)
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; data[i] = w * 0.5 + last * 2.2; }
      this.noiseBuf = buf;
      const mkNoise = (freq, q, type) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const filt = ctx.createBiquadFilter(); filt.type = type || 'lowpass'; filt.frequency.value = freq; filt.Q.value = q || 0.8;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(filt); filt.connect(gain); gain.connect(this.master);
        src.start();
        return { src, filt, gain };
      };
      this.nodes.wind = mkNoise(320, 0.6, 'lowpass');
      this.nodes.waves = mkNoise(520, 0.7, 'lowpass');
      this.nodes.rain = mkNoise(2400, 0.4, 'highpass');
      this.nodes.river = mkNoise(900, 0.8, 'bandpass');
      // slow LFO on wind for gusts
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 90;
      lfo.connect(lfoGain); lfoGain.connect(this.nodes.wind.filt.frequency);
      lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
      const lfo2Gain = ctx.createGain(); lfo2Gain.gain.value = 0.05;
      lfo2.connect(lfo2Gain); lfo2Gain.connect(this.nodes.waves.gain.gain);
      lfo2.start();
      this.enabled = true;
    } catch (e) { this.failed = true; }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  update(dt, game) {
    if (!this.enabled || !this.ctx) return;
    const s = game.settings;
    const vol = (s.mute === 'on' ? 1 : 0) * s.volume / 100;
    const target = game.state === 'playing' ? vol * 0.5 : vol * 0.12;
    const g = this.master.gain;
    g.value += (target - g.value) * Math.min(1, dt * 2);
    if (target <= 0.001 && g.value <= 0.002) return;
    const atm = game.atmosphere, p = game.player, w = game.world;
    const coast = w.coastDistAt(p.x, p.z);
    const waves = clamp(1 - coast / 160, 0, 1);
    const wind = clamp(atm.windSpeed / 15, 0.12, 1);
    const riverNear = w.waterDepthAt(p.x, p.z) > 0.05 && w.waterLevelAt(p.x, p.z) > SEA_LEVEL + 0.01 ? 0.5 :
      (w.biomeAt(p.x, p.z) === BIOME.RIVER ? 0.4 : 0);
    const k = Math.min(1, dt * 1.2);
    this.nodes.wind.gain.gain.value += (wind * 0.5 - this.nodes.wind.gain.gain.value) * k;
    this.nodes.waves.gain.gain.value += (waves * 0.4 - this.nodes.waves.gain.gain.value) * k;
    this.nodes.rain.gain.gain.value += (atm.rain * 0.4 - this.nodes.rain.gain.gain.value) * k;
    this.nodes.river.gain.gain.value += (riverNear * 0.22 - this.nodes.river.gain.gain.value) * k;
    // occasional bird chirps in daytime clear weather
    this.birdTimer = (this.birdTimer || 0) - dt;
    if (this.birdTimer <= 0 && atm.sunEl > 0.05 && atm.rain < 0.15 && game.settings.life === 'on') {
      this.birdTimer = 2 + Math.random() * 9;
      if (Math.random() < 0.65) this.chirp();
    }
  }
  chirp() {
    const ctx = this.ctx; if (!ctx) return;
    try {
      const t0 = ctx.currentTime + 0.05;
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.master);
      const base = 2100 + Math.random() * 1600;
      const n = 2 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++) {
        const ts = t0 + i * (0.09 + Math.random() * 0.05);
        o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), ts);
        o.frequency.exponentialRampToValueAtTime(base * (1.1 + Math.random() * 0.3), ts + 0.05);
        g.gain.setValueAtTime(0, ts);
        g.gain.linearRampToValueAtTime(0.045, ts + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.07);
      }
      o.start(t0); o.stop(t0 + n * 0.16 + 0.1);
    } catch (e) { /* ignore */ }
  }
  thunder() {
    const ctx = this.ctx; if (!ctx || !this.enabled) return;
    try {
      const t0 = ctx.currentTime + 0.02;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 130; filt.Q.value = 0.5;
      const g = ctx.createGain();
      src.connect(filt); filt.connect(g); g.connect(this.master);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.9, t0 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.6 + Math.random() * 1.5);
      filt.frequency.setValueAtTime(190, t0);
      filt.frequency.exponentialRampToValueAtTime(45, t0 + 2.4);
      src.start(t0); src.stop(t0 + 4.5);
    } catch (e) { /* ignore */ }
  }
}
let AUDIO = null;
