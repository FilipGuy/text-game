#!/bin/bash
# Build the single self-contained index.html from src parts.
set -e
cd "$(dirname "$0")"
cat src/00_head.html \
    src/10_core.js src/20_world.js src/25_visibility.js src/30_chunks.js \
    src/40_player.js src/50_render.js src/60_map.js src/70_atmosphere.js src/80_game.js \
    src/99_tail.html > index.html
echo "built index.html ($(wc -c < index.html) bytes)"
