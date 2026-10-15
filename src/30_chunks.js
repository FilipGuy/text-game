/* =====================================================================
 * 30 — CHUNKS (deterministic local scenery)
 * The island's detailed props (trees, bushes, rocks, flowers, logs…) are generated per 48 m chunk
 * from a hash of (seed, chunk coords) when the player approaches, cached in an LRU map, and are
 * identical every time a chunk is regenerated.
 * ===================================================================== */
const CHUNK = 48;                 // metres per chunk side
const CHUNK_CACHE_MAX = 360;

const OBJ = { CONIFER: 0, TREE: 1, BUSH: 2, ROCK: 3, FLOWER: 4, LOG: 5, REED: 6, STUMP: 7, DEADTREE: 8 };

class ChunkManager {
  constructor(world) {
    this.world = world;
    this.cache = new Map();   // key -> { objects: [...] }
    this.seedInt = world.seedInt;
  }
  key(ci, cj) { return ci * 4096 + cj; }

  get(ci, cj) {
    const k = this.key(ci, cj);
    let c = this.cache.get(k);
    if (c) { this.cache.delete(k); this.cache.set(k, c); return c; } // LRU bump
    c = this.generate(ci, cj);
    this.cache.set(k, c);
    if (this.cache.size > CHUNK_CACHE_MAX) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    return c;
  }

  // density of each object type per biome, per chunk (expected counts)
  generate(ci, cj) {
    const w = this.world;
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const objects = [];
    const rng = new RNG(w.seedStr + ':c:' + ci + ':' + cj);
    // quick reject: chunk fully in deep ocean
    const midB = w.biomeAt(x0 + CHUNK / 2, z0 + CHUNK / 2);
    let anyLand = midB !== BIOME.OCEAN;
    if (!anyLand) {
      for (let t = 0; t < 4 && !anyLand; t++) {
        if (w.coarseHeightAt(x0 + (t & 1) * CHUNK, z0 + (t >> 1) * CHUNK) > -2) anyLand = true;
      }
      if (!anyLand) return { objects };
    }
    const tries = 46;
    for (let t = 0; t < tries; t++) {
      const x = x0 + rng.float() * CHUNK, z = z0 + rng.float() * CHUNK;
      if (Math.abs(x) > HALF - 8 || Math.abs(z) > HALF - 8) continue;
      const b = w.biomeAt(x, z);
      if (b === BIOME.OCEAN || b === BIOME.SHALLOW || b === BIOME.LAKE || b === BIOME.RIVER || b === BIOME.SUMMIT) {
        // reeds at calm water edges
        if ((b === BIOME.LAKE || b === BIOME.RIVER || b === BIOME.MARSH) && rng.chance(0.3)) {
          const depth = w.waterDepthAt(x, z);
          if (depth > 0.05 && depth < 0.8) {
            objects.push(this.makeObj(OBJ.REED, x, z, w, rng, 1));
          }
        }
        continue;
      }
      const h = w.heightAt(x, z);
      if (h < 0.4) continue;
      if (w.roadAt(x, z) > 0.42) continue;                       // keep worn paths clear
      if (!this.clearOfLandmarks(x, z)) continue;
      const slope = w.slopeAt(x, z);
      const moist = w.moistAt(x, z);
      const r = rng.float();
      let type = -1, scale = 1;
      switch (b) {
        case BIOME.DENSE_FOREST:
          if (r < 0.62) type = moist > 0.5 ? (rng.chance(0.55) ? OBJ.CONIFER : OBJ.TREE) : (rng.chance(0.65) ? OBJ.TREE : OBJ.CONIFER);
          else if (r < 0.74) type = OBJ.BUSH;
          else if (r < 0.79) type = OBJ.LOG;
          else if (r < 0.83) type = OBJ.STUMP;
          else if (r < 0.86) type = OBJ.ROCK;
          break;
        case BIOME.FOREST:
          if (r < 0.4) type = rng.chance(0.5) ? OBJ.TREE : OBJ.CONIFER;
          else if (r < 0.52) type = OBJ.BUSH;
          else if (r < 0.56) type = OBJ.LOG;
          else if (r < 0.6) type = OBJ.FLOWER;
          else if (r < 0.63) type = OBJ.ROCK;
          break;
        case BIOME.MEADOW:
          if (r < 0.34) type = OBJ.FLOWER;
          else if (r < 0.42) type = OBJ.BUSH;
          else if (r < 0.46) type = rng.chance(0.7) ? OBJ.TREE : OBJ.CONIFER;
          break;
        case BIOME.GRASS:
          if (r < 0.1) type = OBJ.BUSH;
          else if (r < 0.16) type = OBJ.FLOWER;
          else if (r < 0.2) type = rng.chance(0.6) ? OBJ.TREE : OBJ.CONIFER;
          else if (r < 0.23) type = OBJ.ROCK;
          break;
        case BIOME.MARSH:
          if (r < 0.3) type = OBJ.REED;
          else if (r < 0.4) type = OBJ.BUSH;
          else if (r < 0.46) type = OBJ.DEADTREE;
          break;
        case BIOME.HILLS:
          if (r < 0.18) type = OBJ.ROCK;
          else if (r < 0.3) type = rng.chance(0.6) ? OBJ.CONIFER : OBJ.BUSH;
          break;
        case BIOME.ROCK:
          if (r < 0.2) type = OBJ.ROCK;
          else if (r < 0.26 && h < 190) type = OBJ.DEADTREE;
          break;
        case BIOME.CLIFF:
          if (r < 0.16) type = OBJ.ROCK;
          else if (r < 0.2) type = OBJ.BUSH;
          break;
        case BIOME.BEACH:
          if (r < 0.06) type = OBJ.ROCK;
          else if (r < 0.1) type = OBJ.LOG;   // driftwood
          break;
        case BIOME.SNOW:
          if (r < 0.1) type = OBJ.ROCK;
          break;
        default: break;
      }
      if (type < 0) continue;
      if ((type === OBJ.CONIFER || type === OBJ.TREE) && (slope > 0.85 || h > 165)) {
        if (rng.chance(0.7)) continue;
        type = OBJ.DEADTREE;
      }
      if (type === OBJ.FLOWER && slope > 0.5) continue;
      objects.push(this.makeObj(type, x, z, w, rng, scale));
    }
    return { objects };
  }

  makeObj(type, x, z, w, rng, scale) {
    const y = w.heightAt(x, z);
    let height, radius;
    switch (type) {
      case OBJ.CONIFER: height = rng.range(7, 14) * scale; radius = 0.5; break;
      case OBJ.TREE: height = rng.range(5.5, 10) * scale; radius = 0.5; break;
      case OBJ.DEADTREE: height = rng.range(4, 7); radius = 0.4; break;
      case OBJ.BUSH: height = rng.range(1.1, 2.1); radius = 0.9; break;
      case OBJ.ROCK: height = rng.range(0.7, 2.4); radius = height * 0.8; break;
      case OBJ.FLOWER: height = rng.range(0.4, 0.75); radius = 0; break;
      case OBJ.LOG: height = rng.range(0.5, 0.9); radius = 1.6; break;
      case OBJ.REED: height = rng.range(1.0, 1.8); radius = 0; break;
      case OBJ.STUMP: height = rng.range(0.7, 1.3); radius = 0.5; break;
      default: height = 1; radius = 0.4;
    }
    return { type, x, z, y, h: height, r: radius, v: rng.int(0, 7), sway: rng.range(0, TAU) };
  }

  clearOfLandmarks(x, z) {
    for (const L of this.world.landmarks) {
      if (L.clear && Math.abs(L.x - x) < L.clear && Math.abs(L.z - z) < L.clear) return false;
    }
    return true;
  }

  // collect solid obstacles near a point, for player collision
  collectColliders(x, z, radius, out) {
    out.length = 0;
    const ci0 = Math.floor((x - radius) / CHUNK), ci1 = Math.floor((x + radius) / CHUNK);
    const cj0 = Math.floor((z - radius) / CHUNK), cj1 = Math.floor((z + radius) / CHUNK);
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
      const c = this.get(ci, cj);
      for (const o of c.objects) {
        if (o.r <= 0 || o.type === OBJ.LOG || o.type === OBJ.FLOWER || o.type === OBJ.REED) continue;
        if (o.h < 1.0 && o.type === OBJ.ROCK) continue; // small rocks are walkable-over scenery
        const dx = o.x - x, dz = o.z - z;
        if (dx * dx + dz * dz < (radius + o.r) * (radius + o.r)) out.push(o);
      }
    }
    return out;
  }
}
