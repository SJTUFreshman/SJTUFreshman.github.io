# Desktop Pet Task Handoff

## Purpose

Use this document to hand off a future desktop pet creation or repair task to another agent.

The next pet may be any character. Do not assume it is Mochi, a rabbit, or pixel art unless the user explicitly says so or provides a reference that makes it clear.

## Project Scope

This repo is a personal homepage. The desktop pet system should be treated as a self-contained feature.

Default rule:

- Change only the desktop pet system, its entry point, scripts, styles, and pet assets.
- Do not rebuild, restyle, or reorganize the rest of the homepage unless the user explicitly asks.
- If an existing pet entry point works, preserve it and replace only the pet behavior/assets needed for the new task.

## Inputs To Collect

Before implementing, identify:

- Pet name.
- Species or object type.
- Visual style: pixel art, plush, sticker, 3D toy, etc.
- Reference image(s), if provided.
- Required interactions.
- Required movement modes.
- Whether the user wants a full replacement or only a repair.

If the user provides a sprite sheet or keyframes, treat them as visual identity and key pose references, not as the complete final animation unless the user says so.

## Character Identity Rules

Every pet must preserve its own identity.

For any chosen pet:

- Match the provided reference style and proportions.
- Preserve species/body type/material/palette across every frame.
- Do not introduce unrelated props, particles, symbols, or effects.
- Do not let generated frames drift into a different character.
- Do not reuse anatomy from a previous pet.

Species-specific anatomy matters.

Examples:

- A rabbit should move as a low four-foot hopper, not a biped human runner.
- A cat should walk/crouch like a cat, not bounce like a toy ball unless requested.
- A floating object can bob or drift, but should not grow legs unless requested.
- A plush/toy pet can be stylized, but its motion should still match the character concept.

## Required Desktop Pet Behavior

A complete desktop pet system should usually support:

- Summon/show pet from an entry point.
- Dismiss/hide pet.
- Free roam mode: pet wanders around the screen when idle.
- Rest mode: pet moves to a resting place, such as the nav bar or screen edge, and sleeps/rests.
- User-triggered interactions from a menu or hotkeys.
- Food or object interaction when requested: user chooses an item, places it anywhere, pet moves to it and reacts.

Good optional interactions:

- pet/touch
- play
- groom
- sniff/inspect
- follow cursor
- peek from screen edge
- idle tricks

Keep interactions cute, readable, and low-distraction.

## Animation Quality Requirements

The user cares strongly about animation quality. Do not ship placeholder animation.

Required:

- Full continuous action sequences, not just a few keyframes ping-ponged.
- High enough frame count for smooth motion.
- Real in-between poses, not simple stretching, shifting, scaling, or rotation.
- Transitions between all important states.
- Locomotion speed must match visible body/leg/pose cadence.
- If a frame has no movement pose, the pet should not slide across the screen during that frame.
- Idle/rest/sit frames must not drift, wobble, resize, or flicker.
- Frame timing should feel consistent; avoid some actions playing too fast and others too slow.

Directional movement should cover:

- left/right or horizontal movement
- upward/away movement when needed
- downward/toward movement when needed
- transitions between horizontal and vertical directions
- transitions between rest, idle, walk/run, eat, and other major states

## Asset Generation Guidance

When generating frames:

- Use the reference image as the identity source.
- Generate sprite-production sheets with clean separated frames.
- Use a flat removable chroma-key background if transparency is needed.
- No shadows, guide marks, text, labels, grids, speed lines, dust, or detached decorative effects unless specifically requested and compatible with cleanup.
- Inspect generated sheets before extraction.

Important:

- Image models often ignore exact frame counts and spacing.
- Do not blindly cut a generated sheet into equal columns unless the subjects are actually aligned.
- Prefer connected-component extraction after chroma-key cleanup.
- Normalize each extracted frame to a consistent canvas size.
- Keep foot/baseline and center anchor stable.
- Generate contact sheets and fixed-stage previews for QA.

If the result contains cut-off bodies, stray fragments, green residue, or identity drift, reject and repair the row.

## Runtime Stability Requirements

The runtime should avoid visual jitter and flicker.

Recommended implementation rules:

- Use a fixed pet stage size.
- Use fixed rendered sprite dimensions per animation set.
- Do not let each cropped PNG resize the visible sprite independently.
- Use alpha-bound metrics to anchor frames by baseline and center.
- Preload/cache images before switching frames.
- Avoid CSS filters/drop-shadows on rapidly changing sprite images if they cause flicker.
- Keep external bobbing minimal; motion should mostly come from the actual animation frames.
- Do not move the pet while menus are being interacted with.

Movement logic:

- Drive movement distance from animation frame advancement or another cadence-aware mechanism.
- Direction changes should play one-shot transition clips.
- Do not hard-cut from one direction loop to another if transition frames exist.

## Interaction Requirements

Context menu:

- Opens near the pet, not far away.
- Menu items must be clickable.
- Clicking a menu item should close the menu and perform the action.

Food/object placement:

- User chooses item from a tray/menu.
- User clicks a target point on the screen.
- Item appears at that point.
- Pet travels to the item.
- Pet performs a suitable item-specific reaction.
- Item is removed or consumed after the reaction.

Mode switching:

- Roam and rest should be clearly switchable.
- Rest mode should make the pet move to its rest target quickly and then sleep/rest.
- Returning to roam should use a proper wake/stand/walk transition when possible.

## QA Checklist

Before final handoff, verify:

- The pet still matches the requested character in every frame.
- The pet's movement matches its species/object anatomy.
- No biped or wrong-body motion unless explicitly requested.
- No stray disconnected components.
- No generated artifacts, green-screen residue, shadows, guide marks, or cropped body parts.
- No visible size popping.
- No idle/rest jitter.
- No flicker during animation.
- Movement speed matches the visual gait.
- State transitions do not hard cut.
- Right-click/context menu works.
- Food/object placement works.
- Roam/rest switching works.

Recommended static checks:

```powershell
node --check .\path\to\pet-runtime.js
node --check .\path\to\frame-metrics.js
```

Also run a resource scan:

- every runtime-referenced frame exists
- every referenced frame has a metrics entry
- all frames in the same motion set share the same canvas size
- baseline/foot coordinate is stable
- anchor variation is small, usually around 1px or less

Recommended visual QA:

- Contact sheet for all generated frames.
- Fixed-stage preview showing how frames render at runtime scale.
- Browser pass if available:
  - summon pet
  - roam horizontally, diagonally, up, and down
  - rest and wake
  - place each food/object
  - open and click every menu item

## Common Failure Modes

Avoid these:

- Treating a reference sprite sheet as complete animation when it only contains keyframes.
- Claiming high FPS while only stretching or shifting a few frames.
- Letting the pet slide while its body is not visibly moving.
- Cropping every frame differently and causing size popping.
- Missing transition frames between states.
- Accepting generated rows with wrong anatomy.
- Leaving random detached squares or fragments in walk/sit frames.
- Adding non-style-matching decorative effects.
- Using CSS effects that make fast frame swaps flicker.
- Touching unrelated homepage content.

## Handoff Prompt Template

Use this prompt when handing off to another agent:

```text
Please build or repair the desktop pet system using DESKTOP_PET_TASK_HANDOFF.md as the requirements guide.

Pet name: <name>
Pet concept/species: <species or object>
Reference image(s): <paths>
Visual style: <style>
Required interactions: <list>
Required modes: <list>
Scope constraint: change only the desktop pet system; do not touch unrelated homepage content.

Important: generate complete continuous animation frames, preserve the pet's anatomy and identity, include transition frames, sync movement speed to animation cadence, and run visual/resource QA before finishing.
```

## Priority Order

When tradeoffs arise, prioritize:

1. Character identity and anatomy.
2. Natural continuous motion.
3. Stable frame anchoring with no jitter or size popping.
4. Responsive interactions.
5. Clean integration that does not disturb the homepage.
