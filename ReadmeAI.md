# ISLAND

A single-file, first-person, procedurally generated ASCII island exploration game.

**Play:** open `index.html` in any modern desktop browser (works offline, no dependencies).

- Type any seed → Play. Same seed = same island, always.
- W A S D move · mouse look · Shift sprint · Space jump · M full island map · Esc pause.
- Walk, swim, wander. Every island has one dominant snow-capped mountain whose summit is
  guaranteed visible from every place on land whenever you look toward it — validated by a
  line-of-sight pass over the whole island during world generation.
- No combat, no quests, no inventory. Just the island.

## Development
- Source lives in `src/`; `./build.sh` concatenates it into the deliverable `index.html`.
- `node test/run_tests.js` runs the 56-check headless suite (world gen, mountain visibility,
  renderer, movement, map, atmosphere, menus).
- `TASKS.md` tracks verified status; `WORKLOG.md` documents architecture and decisions.
