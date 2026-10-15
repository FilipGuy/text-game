/* Headless harness: loads the game script from the built index.html with DOM/canvas stubs.
 * No browser is available in this sandbox, so this is the strongest available verification. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeCtx2D() {
  return new Proxy({ canvas: null, measureText: () => ({ width: 8 }) }, {
    get(t, k) {
      if (k in t) return t[k];
      return () => {};        // every method is a no-op
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas(w = 1280, h = 720) {
  const cv = {
    width: w, height: h, style: {},
    getContext: () => { const c = makeCtx2D(); c.canvas = cv; return c; },
    addEventListener: () => {},
    requestPointerLock: () => {},
    ownerDocument: null,
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  };
  return cv;
}
function makeElement(id) {
  if (id === 'view' || id === 'mapview') return makeCanvas();
  return {
    id, value: '', textContent: '', style: {},
    classList: { _on: false, add() {}, remove() {}, toggle() {} },
    addEventListener: () => {},
  };
}
function buildSandbox() {
  const elements = new Map();
  const documentStub = {
    readyState: 'complete',
    hidden: false,
    getElementById: (id) => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); },
    createElement: (tag) => tag === 'canvas' ? makeCanvas(512, 512) : makeElement('x'),
    addEventListener: () => {},
    exitPointerLock: () => {},
    pointerLockElement: null,
  };
  const windowStub = {
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener: () => {},
  };
  const rafQueue = [];
  const sandbox = {
    console, Math, Date, Infinity, NaN,
    Float32Array, Float64Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Set, Map, Promise, Array, Object,
    String, Number, Boolean, JSON, Error, isFinite, isNaN, parseFloat, parseInt,
    setTimeout, clearTimeout,
    document: documentStub,
    window: windowStub,
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    performance: { now: () => Date.now() },
    _rafQueue: rafQueue,
    _elements: elements,
  };
  sandbox.globalThis = sandbox;
  windowStub.document = documentStub;
  return sandbox;
}

function loadGame() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('no script block found in index.html');
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { filename: 'index.html(script)' });
  return sandbox;
}

async function drainTicks(sandbox, n = 20000) {
  // resolve pending requestAnimationFrame-based nextTick() chains used by world.generate()
  for (let i = 0; i < n; i++) {
    const q = sandbox._rafQueue.splice(0);
    if (q.length === 0) { await new Promise(r => setImmediate(r)); }
    for (const fn of q) fn(Date.now());
    if (i % 100 === 0) await new Promise(r => setImmediate(r));
  }
}

module.exports = { loadGame, drainTicks, buildSandbox };

if (require.main === module) {
  const sb = loadGame();
  console.log('script loaded OK; classes:',
    ['World', 'MountainGuarantee', 'ChunkManager', 'Player', 'Renderer', 'IslandMap', 'Atmosphere', 'Wildlife', 'ProceduralAudio', 'Game']
      .map(k => k + '=' + typeof vm.runInContext(k, sb)).join(' '));
  console.log('GAME state:', vm.runInContext('GAME.state', sb));
}
