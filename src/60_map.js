/* =====================================================================
 * 60 — FULL ISLAND MAP (M)
 * The complete island is visible from the start. The static layer (terrain, water, landmarks,
 * legend) is rendered once per world into an offscreen canvas; the dynamic layer (player marker,
 * coordinates) is drawn on top every frame while the map is open.
 * ===================================================================== */
class IslandMap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.base = null;
    this.scale = 1; this.ox = 0; this.oy = 0;
  }

  biomeColor(b) {
    switch (b) {
      case BIOME.OCEAN: return '#10243e';
      case BIOME.SHALLOW: return '#1b3a57';
      case BIOME.BEACH: return '#c0b080';
      case BIOME.CLIFF: return '#6f6a62';
      case BIOME.GRASS: return '#4e7a3a';
      case BIOME.MEADOW: return '#6f9a4a';
      case BIOME.FOREST: return '#35602f';
      case BIOME.DENSE_FOREST: return '#27491f';
      case BIOME.HILLS: return '#7a7f55';
      case BIOME.ROCK: return '#8a8680';
      case BIOME.SNOW: return '#e6e9ee';
      case BIOME.LAKE: return '#2b5d86';
      case BIOME.RIVER: return '#3a7096';
      case BIOME.PATH: return '#9a8a66';
      case BIOME.MARSH: return '#4a6b46';
      case BIOME.SUMMIT: return '#ffffff';
      default: return '#333';
    }
  }

  buildBase() {
    const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const W = this.canvas.width, H = this.canvas.height;
    const base = doc.createElement('canvas');
    base.width = W; base.height = H;
    const ctx = base.getContext('2d');
    ctx.fillStyle = '#060a08'; ctx.fillRect(0, 0, W, H);
    // layout: map square centered-left, legend right
    const legendW = Math.min(300, W * 0.3);
    const size = Math.min(W - legendW - 60, H - 90);
    const ox = 30, oy = (H - size) / 2;
    this.scale = size / WORLD_SIZE; this.ox = ox + size / 2; this.oy = oy + size / 2;
    const w = this.world;
    const px = size / GRID;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const b = w.biome[j * GRID + i];
        ctx.fillStyle = this.biomeColor(b);
        // shade by elevation
        ctx.fillRect(ox + i * px, oy + j * px, px + 0.6, px + 0.6);
      }
    }
    // elevation shading pass (cheap hillshade)
    ctx.globalAlpha = 0.28;
    for (let j = 1; j < GRID; j += 2) {
      for (let i = 1; i < GRID; i += 2) {
        const k = j * GRID + i;
        if (w.h[k] < 0) continue;
        const sh = (w.h[k - 1] - w.h[k + 1]) * 0.05;
        if (sh > 0.08) { ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + i * px, oy + j * px, px * 2, px * 2); }
        else if (sh < -0.08) { ctx.fillStyle = '#000000'; ctx.fillRect(ox + i * px, oy + j * px, px * 2, px * 2); }
      }
    }
    ctx.globalAlpha = 1;
    const font = (s) => s + 'px Consolas, Menlo, "DejaVu Sans Mono", monospace';
    // landmarks
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const L of w.landmarks) {
      const mx = this.ox + L.x * this.scale, my = this.oy + L.z * this.scale;
      if (L.type === 'summit') {
        ctx.font = font(18); ctx.fillStyle = '#ffffff'; ctx.fillText('▲', mx, my);
        ctx.font = font(11); ctx.fillStyle = '#d8dde2'; ctx.fillText('THE SUMMIT', mx, my - 14);
      } else {
        ctx.font = font(13); ctx.fillStyle = '#e8d8a8';
        const g = L.type === 'ruin' ? '+' : (L.type === 'bus' || L.type === 'truck') ? '#' : L.type === 'arch' ? 'n' : 'o';
        ctx.fillText(g, mx, my);
      }
    }
    // frame + north
    ctx.strokeStyle = '#2d3b2c'; ctx.strokeRect(ox - 1, oy - 1, size + 2, size + 2);
    ctx.font = font(16); ctx.fillStyle = '#9fd58a'; ctx.textAlign = 'center';
    ctx.fillText('N', ox + size / 2, oy - 16);
    ctx.fillText('↑', ox + size / 2, oy - 30);
    // legend
    const lx = ox + size + 28;
    let ly = oy + 4;
    ctx.textAlign = 'left';
    ctx.font = font(15); ctx.fillStyle = '#9fd58a';
    ctx.fillText('ISLAND MAP', lx, ly); ly += 24;
    ctx.font = font(12);
    const entries = [
      [BIOME.OCEAN, 'Ocean'], [BIOME.SHALLOW, 'Shallows'], [BIOME.BEACH, 'Beach'],
      [BIOME.CLIFF, 'Cliffs'], [BIOME.GRASS, 'Grassland'], [BIOME.MEADOW, 'Meadow'],
      [BIOME.FOREST, 'Forest'], [BIOME.DENSE_FOREST, 'Dense forest'], [BIOME.HILLS, 'Rocky hills'],
      [BIOME.ROCK, 'Bare rock'], [BIOME.SNOW, 'Snow'], [BIOME.LAKE, 'Lake / pond'],
      [BIOME.RIVER, 'River'], [BIOME.MARSH, 'Marsh'], [BIOME.PATH, 'Worn path'],
    ];
    for (const [b, name] of entries) {
      ctx.fillStyle = this.biomeColor(b); ctx.fillRect(lx, ly - 8, 12, 10);
      ctx.fillStyle = '#b8c4b0'; ctx.fillText(name, lx + 20, ly);
      ly += 17;
    }
    ly += 6;
    ctx.fillStyle = '#e8d8a8';
    ctx.fillText('▲  dominant summit', lx, ly); ly += 17;
    ctx.fillText('+  ruins      #  vehicle', lx, ly); ly += 17;
    ctx.fillText('n  rock arch  o  stones', lx, ly); ly += 17;
    ctx.fillStyle = '#7fb0ff'; ctx.fillText('@  you (view direction shown)', lx, ly); ly += 26;
    ctx.fillStyle = '#7f8f78';
    ctx.fillText('Seed: ' + w.seedStr, lx, ly); ly += 17;
    this.coordY = ly; this.coordX = lx;
    ly += 24;
    ctx.fillText('M or ESC to close', lx, ly);
    this.base = base;
  }

  draw(player) {
    if (!this.base || this.base.width !== this.canvas.width || this.base.height !== this.canvas.height) {
      this.base = null; this.buildBase();
    }
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    // player marker
    const mx = this.ox + player.x * this.scale, my = this.oy + player.z * this.scale;
    ctx.save();
    ctx.translate(mx, my);
    ctx.fillStyle = '#7fb0ff';
    ctx.font = '14px Consolas, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('@', 0, 0);
    // view direction
    ctx.strokeStyle = '#7fb0ff';
    ctx.beginPath();
    ctx.moveTo(Math.sin(player.yaw) * 7, Math.cos(player.yaw) * 7);
    ctx.lineTo(Math.sin(player.yaw) * 16, Math.cos(player.yaw) * 16);
    ctx.stroke();
    ctx.restore();
    // live coordinates
    ctx.fillStyle = '#7f8f78';
    ctx.font = '12px Consolas, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Position: ' + Math.round(player.x) + ', ' + Math.round(player.z) +
      '   Elevation: ' + Math.max(0, player.y).toFixed(0) + ' m        ', this.coordX, this.coordY + 17);
  }
}
