# AUTONOMOUS AGENT TASK: BUILD THE COMPLETE ASCII ISLAND EXPLORER

## 1. Mission

You are an autonomous senior game developer working directly in my coding workspace.

Your task is to DESIGN, IMPLEMENT, RUN, TEST, DEBUG, AND FINISH a complete browser-based game called **ISLAND**.

I do not want a tutorial, a development plan, a code sample, or a prototype. I want the actual finished game saved in my workspace so I can return to it and play.

**You must execute the work, not merely explain how you would execute it.**

Work independently until the project meets the completion criteria. Do not stop after writing a plan, implementing a basic demo, finishing one phase, or encountering the first significant bug. Make reasonable decisions without asking me questions.

If your environment supports persistent autonomous tasks, task lists, terminal execution, browser testing, and file editing, use those capabilities to complete the entire project.

## 2. Mandatory autonomous working rules

Follow these rules throughout the task.

### Rule A: Start working immediately

Inspect the current workspace, identify the existing project files and available tools, and understand how the environment works.

If a project already exists, inspect it before making changes. Preserve useful existing work and avoid unnecessarily replacing unrelated files.

If the workspace is empty, create the required game file.

After inspecting the workspace, begin implementation. Do not spend the entire task writing plans or describing architecture.

### Rule B: Maintain a persistent task checklist

Create a temporary development checklist named `TASKS.md`, unless an equivalent task-management system already exists.

Break the work into concrete implementation and testing tasks. Mark tasks complete only after implementing and verifying them.

Keep track of:

- What is implemented.
- What remains unfinished.
- Which tests have passed.
- Which bugs remain.
- What must happen next.

Use this checklist to manage your work, not as a substitute for doing it.

### Rule C: Complete every phase autonomously

Implement the game in phases, but do not wait for my approval between phases.

After completing each phase, test it, fix obvious problems, and continue into the next phase.

When something fails, investigate the cause, modify the code, and test again. Try reasonable alternatives when your first approach fails.

Do not repeatedly rewrite the entire application from scratch. Make focused changes that preserve working systems.

### Rule D: Keep going until the game is finished

Never declare success merely because the code has been written or the page opens.

Continue until the complete playable game has been implemented and the available tests pass.

Do not abandon difficult requirements simply because they are technically challenging. In particular, the dominant mountain visibility guarantee, procedural terrain generation, actual first-person rendering, and smooth movement are essential.

Do not replace a difficult feature with a button that does nothing, a static screenshot, a fake loading screen, or a placeholder implementation.

### Rule E: Make decisions without asking me

Do not ask questions or request confirmation.

Use the specification below as the source of truth. When a minor detail is unspecified, choose a sensible implementation that fits the game.

Prioritize correctness, playability, performance, and completeness over unnecessary features.

### Rule F: Protect progress

Save changes to disk as you work.

If your environment has context limits, execution limits, or resumable tasks, maintain a concise `WORKLOG.md` containing the current state, completed work, remaining tasks, test results, important technical decisions, and the precise next actions.

If interrupted, resume from the saved state rather than starting over.

Do not intentionally stop early while unfinished work remains. If the execution environment imposes a hard limit, preserve all progress and make the remaining work immediately resumable.

### Rule G: Verify the actual result

Use the available terminal, browser, developer tools, and testing tools where possible.

Read error messages. Examine browser console errors. Run the game. Exercise its controls. Test procedural generation. Fix failures and repeat.

Never claim that a test passed unless you actually performed it.

If a particular browser test cannot be executed because a tool is unavailable, perform the strongest available alternative and clearly identify that specific limitation.

---

# 3. Final product requirements

Build a single-player, first-person, procedurally generated island exploration game.

The game must use:

- One self-contained `index.html` file.
- Embedded HTML, CSS, and vanilla JavaScript.
- HTML Canvas for the entire ASCII game world.
- No external libraries, frameworks, packages, CDNs, images, textures, models, or downloaded assets.
- No backend, account, API, internet connection, or installation requirement.
- Deterministic seeded generation.
- Smooth first-person movement and mouse-look.
- A huge but finite island surrounded by an ocean.

The interface may use ordinary HTML and CSS for menus and settings. Every environmental visual must be generated from ASCII characters drawn to Canvas.

The game must run offline in a modern desktop browser.

Deliver the finished `index.html` in the existing project workspace. Do not deliver only code inside a chat response.

# 4. The actual game

The title is **ISLAND**.

The player explores a vast natural island from a first-person perspective. The world contains forests, grasslands, meadows, mountains, rivers, lakes, beaches, cliffs, bushes, rocks, flowers, and other natural scenery.

Occasionally, the player may discover unusual natural formations, isolated ruins, worn paths, or abandoned vehicles. The environment should feel overwhelmingly natural and peaceful.

The game has no required objective or ending.

There must be no combat, survival mechanics, quests, inventory, crafting, character progression, multiplayer, or required story.

The entire experience revolves around freely exploring the landscape.

# 5. Non-negotiable mountain visibility requirement

Every generated island must have one unmistakable dominant mountain with a distinctive summit.

**The summit must be visible from every land location whenever the player looks toward it.**

This must be guaranteed through the actual terrain-generation and visibility systems. It must not be implemented by simply drawing a mountain over foreground objects.

Implement a dedicated mountain-generation and visibility-validation system.

Requirements:

1. Every seed produces a dominant mountain.
2. The summit is substantially higher than every secondary peak.
3. The mountain is positioned and shaped so it can be seen across the island.
4. Ordinary hills, ridges, forests, and secondary mountains cannot permanently obstruct its summit.
5. The renderer must not cull it because of normal object-rendering distance.
6. The summit must remain correctly positioned in the world when the player moves and turns.
7. Validation must cover the entire coarse land grid, not just a few sample locations.
8. Use elevation sampling and line-of-sight checks to identify terrain obstructions.
9. Correct obstructing terrain smoothly and repeat validation until every tested land location passes.
10. Account for positions between coarse grid samples using conservative visibility margins or additional sampling.

Design the overall island around this requirement. Establish suitable elevation and slope constraints before generating detailed scenery.

The mountain must look like a real part of the terrain. Never attach it to the camera, draw it as a static screen overlay, or fake visibility using incorrect depth ordering.

If visibility fails, fix the world generator or terrain constraints before proceeding.

# 6. Procedural world generation

Use a hybrid generation system:

- Generate global geography first.
- Maintain a deterministic coarse heightfield and biome representation.
- Generate detailed local scenery in chunks as the player approaches.
- Use seeded random generation and coordinate-based hashing for repeatable details.

The same seed must recreate the same island, including major terrain, mountain position, coastlines, biomes, lakes, rivers, and landmarks.

The world must be finite and have clear boundaries.

Generate believable natural geography through layered noise, elevation constraints, and coherent biome assignment.

Include:

- Dense forests.
- Open plains and grasslands.
- Flower-filled meadows.
- Hills and mountain ranges.
- Sandy beaches and rocky cliffs.
- Lakes and ponds.
- Rivers and streams.
- Bushes, flowers, rocks, fallen logs, and other natural details.

Rivers should generally follow downhill terrain and drain toward lakes or the ocean. Lakes should occupy plausible basins. Biome boundaries should transition naturally.

Include occasional rare natural landmarks, isolated ruins, old buses or vehicles, and worn paths, but keep these uncommon.

Do not generate populated cities, NPCs, or dense road networks.

Generate global terrain once per world. Do not regenerate the entire island every frame.

# 7. First-person ASCII renderer

Build a genuine pseudo-3D first-person renderer using HTML Canvas.

Use a consistent logical character grid, perspective projection, depth handling, terrain elevation, lighting, and distance-based detail.

Use actual printable ASCII characters for the environment.

Examples of the visual language:

- Grass: `. , ' "`
- Trees: `Y T / \ |`
- Bushes: `* % &`
- Rocks: `# ^ :`
- Mountain surfaces: `^ / \ #`
- Sand: `. , :`
- Water: `~ - =`
- Roads: `. : =`
- Ruins: `+ # |`

Use multi-character patterns at close range to make trees and other objects recognizable. Simplify distant objects while preserving their identity.

Implement:

- Natural colors.
- Terrain shading.
- Atmospheric depth and distance fading.
- Configurable field of view.
- Adaptive character density.
- Adjustable rendering distance.
- Multiple graphics-quality levels.
- Responsive Canvas resizing.
- Correct depth ordering.
- Efficient rendering of the terrain and environmental objects.

The game must look and behave like a first-person world, not a top-down map or a collection of static ASCII scenes.

# 8. Movement and environment interaction

Default controls:

- W: move forward.
- S: move backward.
- A/D: strafe.
- Mouse: look around.
- Shift: sprint.
- Space: jump.
- M: toggle the full island map.
- Escape: release the mouse or open the pause menu as appropriate.

Use pointer lock for mouse-look and handle losing or recapturing pointer lock correctly.

Implement smooth acceleration, deceleration, appropriate movement physics, frame-rate-independent movement, terrain collision, and sensible slopes.

Prevent walking through cliffs, getting stuck in terrain, or crossing the island boundary into undefined areas.

Allow swimming across lakes, rivers, and coastal water. Keep swimming simple and peaceful. Do not add oxygen, stamina, drowning, or survival systems.

Do not implement a dedicated underwater exploration system.

# 9. Full ASCII map

The entire island map must be visible from the beginning, even in unexplored areas.

Press M to open or close a large ASCII map rendered using Canvas.

Display recognizable color-coded representations of:

- Ocean and island coastline.
- Forests, plains, and meadows.
- Mountains and the dominant summit.
- Beaches, cliffs, lakes, and rivers.
- Roads, paths, and major landmarks.
- Rare abandoned structures when present.
- The player's current position.
- North direction.
- A legend.
- The world seed and player coordinates.

Update the player's marker as they move.

Make the map readable, responsive, and easy to open or close without resetting the world.

# 10. Dynamic atmosphere

Implement a continuous day/night cycle, weather transitions, and atmospheric effects.

Include clear weather, haze, fog, rain, heavy rain, and occasional storms.

Render rain, fog, water animation, and other visual effects using ASCII characters.

Lighting should change naturally from sunrise through daytime, sunset, and night. Night should be darker but still navigable.

Weather must transition smoothly and should not change randomly on every frame.

The graphics settings must allow expensive effects to be reduced or disabled.

# 11. Living nature and sound

Make the island feel alive without introducing new gameplay systems.

Include subtle wind-driven vegetation, animated water, drifting fog, falling rain, and occasional passive birds or butterflies represented by ASCII characters.

Wildlife must never attack, obstruct, or follow the player.

Generate optional ambient audio through the Web Audio API, without external audio files.

Include wind, rain, ocean waves, and subtle environmental ambience where practical.

Provide volume and mute settings. Activate audio only after user interaction when required by browser policies.

The game must remain playable if audio is unavailable or disabled.

# 12. Menus and interface

Create a polished minimalist title screen containing:

- The title ISLAND.
- A custom world-seed input.
- A Play button.
- A Settings button.
- Brief control instructions.

Validate the seed and show an informative error for empty input.

Generate the world deterministically and show loading progress while critical generation and mountain-visibility validation are taking place.

Do not start gameplay until the required world data is ready.

Include a pause menu with Resume, Settings, and Return to Title.

Settings must include graphics quality, ASCII density, rendering distance, field of view, mouse sensitivity, movement speeds, weather effects, and audio controls.

During exploration, keep the interface minimal. Use only a small optional crosshair and unobtrusive map or pause controls.

Do not add health bars, quest indicators, inventories, stamina bars, notifications, or unnecessary permanent HUD elements.

Do not persist settings or player progress between sessions.

# 13. Technical architecture

Organize the JavaScript in clearly separated classes or functions within the single HTML file.

Use appropriate components for:

- Main game lifecycle.
- Seed handling and world generation.
- Terrain and biome sampling.
- Rivers and lakes.
- Chunk management.
- Mountain visibility validation.
- Player movement and collision.
- ASCII perspective rendering.
- Map rendering.
- Weather and day/night.
- Environmental animation.
- Procedural audio.
- Menus and settings.

Keep generation deterministic and separate from rendering. Use a single source of truth for world coordinates, settings, and player state.

Use `requestAnimationFrame`, delta-time movement, cached terrain data, reusable objects, efficient Canvas operations, and typed arrays where beneficial.

Avoid large allocations every frame, repeatedly scanning the entire island, or recalculating global terrain during movement.

Adapt rendering detail to the selected quality settings. Preserve the dominant mountain visibility requirement at every setting.

Handle browser resizing, pointer-lock loss, tab switching, large frame-time spikes, and invalid input gracefully.

# 14. Required autonomous implementation workflow

Execute the following phases in order. Update the task checklist as the work progresses.

### Phase 1: Foundation
Create the HTML file, title screen, Canvas, main loop, seed input, controls, pointer lock, and first-person rendering foundation.

### Phase 2: Global geography
Implement deterministic generation, island boundaries, elevation, the dominant mountain, biomes, and coastlines.

### Phase 3: Mountain guarantee
Implement terrain constraints, line-of-sight validation, smooth corrections, and visibility tests. Do not proceed until this system works.

### Phase 4: Detailed world
Implement chunks, trees, bushes, rocks, meadows, rare natural formations, roads, occasional ruins, and rare abandoned vehicles.

### Phase 5: Terrain interaction
Implement rivers, lakes, slopes, collision, jumping, swimming, and boundary handling.

### Phase 6: Map
Implement the complete island map, legend, player position, seed, coordinates, and controls.

### Phase 7: Atmosphere
Implement the day/night cycle, lighting, fog, rain, storms, moving vegetation, water, wildlife, and procedural audio.

### Phase 8: Menus and optimization
Complete the settings, loading and pause menus, adaptive rendering, browser-resize support, and performance optimization.

### Phase 9: Actual testing
Run the game, exercise the controls, test multiple seeds, inspect errors, verify mountain visibility, and fix issues.

Do not stop at the end of a phase. Automatically continue into the next phase.

If an implementation approach repeatedly fails, reconsider the algorithm and try a more reliable approach instead of abandoning the feature.

# 15. Mandatory verification

Before declaring the project complete, verify as many of the following as the environment supports.

**Startup and controls**
- The local HTML file opens.
- A valid seed starts a game.
- An empty seed is rejected.
- Mouse-look and movement work.
- Movement is frame-rate independent.
- Jumping and swimming work.
- The map, settings, pause, and resume functions work.
- Resizing the browser does not break the game.

**Procedural generation**
- The same seed reproduces the same major geography.
- Different seeds produce different islands.
- Terrain and scenery remain consistent across chunk boundaries.
- All expected biomes can be generated.
- Rivers and lakes fit the terrain.
- The island has no missing terrain sections.

**Mountain visibility**
- Test multiple different seeds.
- Check every coarse land cell.
- Test beaches, forests, plains, meadows, elevated land, and coastal areas.
- Test different viewing directions, explicitly turning toward the summit.
- Check intermediate player positions.
- Verify terrain does not obscure the summit.
- Verify the mountain is not incorrectly removed by rendering-distance settings.

**Map and atmosphere**
- The entire island map is available immediately.
- The player marker moves correctly.
- The map legend is readable.
- Weather and day/night change correctly.
- ASCII effects remain readable.
- Sound controls work and the game remains playable without sound.

**Performance and stability**
- Run the game during normal exploration.
- Observe browser console errors.
- Confirm global terrain is not regenerated every frame.
- Confirm chunks load without persistent freezing.
- Confirm graphics-quality settings change rendering work.
- Check for obvious memory leaks during repeated play and menu use.

Use available automated browser tools or other existing testing facilities. Do not install external dependencies just to test the game if doing so would violate the offline, self-contained requirement.

Fix discovered defects and rerun the relevant tests.

If a required feature fails, it remains unfinished. If a test cannot be performed, record the reason rather than pretending it passed.

# 16. Features that must never be added

Do not introduce:

- Combat, weapons, enemies, bosses, or health systems.
- Hunger, thirst, oxygen, drowning, or stamina management.
- Survival mechanics.
- Inventory, crafting, loot, currency, or building.
- Quests, missions, achievements, or required objectives.
- Levels, skill trees, or character progression.
- Multiplayer, accounts, or online features.
- NPCs, populated cities, or traffic.
- Images, textures, 3D models, or external assets.
- External JavaScript libraries or online dependencies.
- Browser persistence or save/load systems.
- An unbounded infinite world that replaces the finite island.

Abandoned vehicles, rare structures, and natural landmarks are scenery only.

Do not add features just to make the project look more complicated.

# 17. Definition of done

The project is complete only when:

1. The finished `index.html` exists in the workspace.
2. It runs offline without external dependencies.
3. The player can explore the procedurally generated island in first person.
4. Seeded world generation is deterministic.
5. The island contains the required natural geography.
6. The dominant mountain visibility system is implemented and validated.
7. Movement, terrain interaction, swimming, and the map work.
8. The atmospheric systems and menus work.
9. Available tests have been executed and failures have been addressed.
10. No known critical bug remains.
11. The task checklist accurately reflects the verified status.

Do not mark the task complete because all implementation tasks have been attempted. Mark them complete only when the corresponding functionality has been tested.

# 18. Final response

Once the game is finished, give me a concise report containing:

- The exact location of the completed `index.html`.
- What was implemented.
- Which tests were run and passed.
- Any remaining known issues or unverified requirements.
- How to open and play the game.

Do not paste the entire source code into your final response when the workspace already contains the file.

Do not claim that the game is fully tested if you have not run it.

**YOUR NEXT ACTION: Inspect the workspace, create or update the task checklist, and begin implementing the game immediately. Continue autonomously until the completion criteria are met. Do not stop after planning.**
