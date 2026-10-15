/* =====================================================================
 * 40 — PLAYER (movement, physics, collision, swimming)
 * Frame-rate independent: all integration uses dt; input only sets wishes.
 * ===================================================================== */
const EYE_HEIGHT = 1.65;
const SWIM_DEPTH = 1.15;      // water deeper than this -> swimming
const MAX_STEP = 1.05;        // max instant step-up (m)
const MAX_SLOPE = 1.75;       // gradient above which walking uphill is blocked

class Player {
  constructor(world, chunks) {
    this.world = world;
    this.chunks = chunks;
    this.x = world.spawn.x; this.z = world.spawn.z;
    this.y = world.heightAt(this.x, this.z);
    this.yaw = world.spawn.yaw; this.pitch = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.grounded = true; this.swimming = false; this.waterDepth = 0;
    this.keys = { f: 0, b: 0, l: 0, r: 0, sprint: 0, jump: 0 };
    this.bob = 0; this.bobAmp = 0;
    this._colliders = [];
    this.radius = 0.38;
  }

  eyeY() {
    if (this.swimming) return this.world.waterLevelAt(this.x, this.z) + 0.55 + Math.sin(this.bob * 0.6) * 0.07;
    return this.y + EYE_HEIGHT + Math.sin(this.bob) * 0.055 * this.bobAmp;
  }

  look(dx, dy, sens, invertY) {
    this.yaw -= dx * 0.0022 * sens;
    this.pitch += (invertY ? dy : -dy) * 0.0022 * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = clamp(this.pitch, -lim, lim);
    if (this.yaw > Math.PI) this.yaw -= TAU; else if (this.yaw < -Math.PI) this.yaw += TAU;
  }

  update(dt, settings) {
    const w = this.world;
    const walkSpeed = settings.walk, sprintSpeed = settings.sprint;
    // wish direction in world space (yaw: 0 => +z)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = 0, wz = 0;
    const fwd = this.keys.f - this.keys.b, strafe = this.keys.r - this.keys.l;
    if (fwd || strafe) {
      wx = sin * fwd + cos * strafe;
      wz = cos * fwd - sin * strafe;
      const n = Math.hypot(wx, wz); wx /= n; wz /= n;
    }
    const ground = w.heightAt(this.x, this.z);
    const wl = w.waterLevelAt(this.x, this.z);
    this.waterDepth = Math.max(0, wl - ground);
    const wading = this.waterDepth > 0.25 && !this.swimming;
    this.swimming = this.waterDepth > SWIM_DEPTH;

    let speed = this.keys.sprint ? sprintSpeed : walkSpeed;
    if (this.swimming) speed = Math.min(speed, walkSpeed * 0.62);
    else if (wading) speed *= 0.6;

    // exponential approach to the wish velocity — frame-rate independent by construction:
    // v(t+dt) = target + (v - target) * exp(-rate*dt)
    const hasInput = (wx !== 0 || wz !== 0);
    const rate = this.swimming ? (hasInput ? 3.2 : 2.2)
      : this.grounded ? (hasInput ? 9 : 11)
      : 1.1;                                  // low air control
    const kv = 1 - Math.exp(-rate * dt);
    this.vx += (wx * speed - this.vx) * kv;
    this.vz += (wz * speed - this.vz) * kv;
    const hs = Math.hypot(this.vx, this.vz);
    if (hs > speed * 1.02) { this.vx *= speed / hs; this.vz *= speed / hs; }

    if (this.swimming) {
      // bob gently at the surface; Space paddles up a little, used for climbing ashore
      this.vy = lerp(this.vy, this.keys.jump ? 1.3 : 0, 1 - Math.exp(-4 * dt));
      this.y = wl - SWIM_DEPTH * 0.55;
      this.grounded = false;
    } else {
      if (this.grounded && this.keys.jump) { this.vy = 5.6; this.grounded = false; }
      if (!this.grounded) this.vy -= 15.5 * dt;
    }

    // integrate with collision, axis-separated
    this.moveAxis(this.vx * dt, 0);
    this.moveAxis(0, this.vz * dt);

    // vertical / ground following
    const g2 = w.heightAt(this.x, this.z);
    if (this.swimming) {
      const wl2 = w.waterLevelAt(this.x, this.z);
      this.y = wl2 - SWIM_DEPTH * 0.55 + Math.min(0.4, this.vy * 0.15);
      if (g2 > this.y) { this.y = g2; this.swimming = false; this.grounded = true; this.vy = 0; }
    } else if (this.grounded) {
      this.y = g2;
      this.vy = 0;
    } else {
      this.y += this.vy * dt;
      if (this.y <= g2) { this.y = g2; this.vy = 0; this.grounded = true; }
    }

    // view bob
    const moving = hs > 0.4 && (this.grounded || this.swimming);
    this.bobAmp = lerp(this.bobAmp, moving ? Math.min(1.6, hs / walkSpeed) : 0, 1 - Math.exp(-8 * dt));
    if (moving) this.bob += dt * (4.5 + hs * 0.55);
  }

  // attempt to move along one axis with terrain-step and obstacle rules
  moveAxis(dx, dz) {
    if (!dx && !dz) return;
    const w = this.world;
    let nx = this.x + dx, nz = this.z + dz;
    // world boundary: soft wall far out at sea
    const lim = HALF - 24;
    nx = clamp(nx, -lim, lim); nz = clamp(nz, -lim, lim);
    // terrain step / slope rules (only when not swimming)
    if (!this.swimming) {
      const hHere = this.y;
      const hThere = w.heightAt(nx, nz);
      const wlThere = w.waterLevelAt(nx, nz);
      const rise = hThere - hHere;
      if (rise > MAX_STEP && wlThere < hThere) {
        // try sliding: keep the other axis
        const g = w.gradAt(nx, nz);
        const slope = Math.hypot(g[0], g[1]);
        if (slope > MAX_SLOPE || rise > 2.2) return;  // too steep: blocked
        if (rise > MAX_STEP) return;
      }
      if (this.grounded && rise < -7) {
        // walking off a tall cliff: allow, becomes a fall
        this.grounded = false;
        this.vy = Math.min(this.vy, 0);
      }
    }
    // object collision (circle push-out)
    const cols = this.chunks.collectColliders(nx, nz, this.radius + 2.2, this._colliders);
    for (const o of cols) {
      // ignore obstacles far below or above
      if (o.y > this.y + 2.2 || o.y + o.h < this.y + 0.3) continue;
      const ddx = nx - o.x, ddz = nz - o.z;
      const d2 = ddx * ddx + ddz * ddz, rr = this.radius + o.r;
      if (d2 < rr * rr && d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (rr - d);
        nx += (ddx / d) * push; nz += (ddz / d) * push;
      }
    }
    // landmark solid parts
    const game = typeof GAME !== 'undefined' ? GAME : null;
    if (game && game.landmarkColliders) {
      for (const c of game.landmarkColliders) {
        const ddx = nx - c.x, ddz = nz - c.z;
        const d2 = ddx * ddx + ddz * ddz, rr = this.radius + c.r;
        if (d2 < rr * rr && d2 > 1e-9 && this.y < c.y + c.h && this.y + 1.6 > c.y) {
          const d = Math.sqrt(d2), push = (rr - d);
          nx += (ddx / d) * push; nz += (ddz / d) * push;
        }
      }
    }
    this.x = clamp(nx, -lim, lim);
    this.z = clamp(nz, -lim, lim);
  }
}
