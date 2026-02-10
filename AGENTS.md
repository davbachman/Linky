# AGENTS.md

This file is for future coding agents working in this repository.

## Project Overview

- App: linkage editor/simulator built with React + TypeScript + Canvas.
- Purpose: create and edit rigid-stick mechanisms with pivots, anchors, interior stick attachments, line constraints, pens, and physics playback.
- Entry points:
  - `/Users/davidbachman/Documents/LinkageApp/src/main.tsx`
  - `/Users/davidbachman/Documents/LinkageApp/src/App.tsx`

## Stack and Commands

- Runtime: React 18, Vite 5, TypeScript strict mode.
- Tests: Vitest + Testing Library + jsdom.
- Commands:
  - `npm run dev`
  - `npm run build`
  - `npm test`
  - `npm run test:watch`

## Repo Map

- UI:
  - `/Users/davidbachman/Documents/LinkageApp/src/App.tsx`
  - `/Users/davidbachman/Documents/LinkageApp/src/ui/Toolbar.tsx`
  - `/Users/davidbachman/Documents/LinkageApp/src/canvas/LinkageCanvas.tsx`
  - `/Users/davidbachman/Documents/LinkageApp/src/styles.css`
- Model/engine:
  - `/Users/davidbachman/Documents/LinkageApp/src/model/types.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/model/store.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/model/solver.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/model/hitTest.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/model/render.ts`
- Tests:
  - `/Users/davidbachman/Documents/LinkageApp/src/test/store.test.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/test/app.integration.test.tsx`
  - `/Users/davidbachman/Documents/LinkageApp/src/test/solver.test.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/test/hitTest.test.ts`
  - `/Users/davidbachman/Documents/LinkageApp/src/test/setup.ts`
- Deploy:
  - `/Users/davidbachman/Documents/LinkageApp/.github/workflows/deploy.yml`
  - `/Users/davidbachman/Documents/LinkageApp/vite.config.ts` (`base: '/Linky/'` for GitHub Pages)

## Current Product Behavior (Important)

- Visible toolbar tools: `Stick`, `Anchor`, `Line`, `Pen`, `Play`, `Clear`, `Stop`.
- `Circle` logic still exists in store/types/hitTest, but the circle tool is not exposed in the toolbar.
- Selection in non-physics mode is broad: clicking pivots/anchors/pens/sticks/lines selects for edit/delete.
- Delete key behavior is driven by selection state in `App.tsx`.
- Editing is locked while physics is enabled:
  - Store rejects stick/anchor/line/pen/circle edits in physics mode.
  - Dragging a non-anchor pivot is allowed in physics mode to inject momentum.
  - Anchors are fixed in physics mode and cannot be dragged.

## Input and Interaction Rules

- Canvas world/screen transforms:
  - Wheel zoom.
  - Pan via middle mouse drag, or `Space` + left drag.
- Stick creation:
  - Starts on pointer-down in stick mode.
  - End resolved on pointer-up in `endStick(...)`.
  - Can snap to existing pivot, line, or interior of existing stick.
  - Interior hits create `AttachmentConstraint` (not hidden helper sticks).
- Stick resize:
  - Select stick, then drag endpoint.
  - On release, endpoint may snap to interior of another stick and create attachment.
- Drag snapping:
  - Line snap applies in `updateDrag(...)` when close.
  - Hold `Shift` while dragging/releasing to disable snapping.
  - `Shift` bypass currently affects:
    - drag-to-line snapping
    - stick endpoint release snapping
    - resize endpoint release interior snap

## Scene and Constraint Model

- Core scene types are in `/Users/davidbachman/Documents/LinkageApp/src/model/types.ts`.
- Main topology entities:
  - `nodes` (pivots/anchors)
  - `sticks` (distance constraints)
  - `attachments` (node fixed at parameter `t` along a host stick)
  - `lines` (line constraints)
  - `circles` (present in model, currently not in toolbar)
- Interior stick attachments are explicit first-class constraints:
  - `AttachmentConstraint = { id, nodeId, hostStickId, t }`
  - Node tracks at most one attachment via `node.attachmentId`.
- Hidden-stick midpoint attachment representation is intentionally removed.

## Physics Engine Notes

- Physics lives in `/Users/davidbachman/Documents/LinkageApp/src/model/store.ts`.
- Integrator options:
  - `'rattle_symplectic'` (default)
  - `'legacy_projection'` (fallback)
- Default physics options:
  - `substeps: 4`
  - `constraintIterations: 12`
  - `positionTolerance: 1e-4`
  - `velocityTolerance: 1e-5`
  - `energyMode: 'strict'`
- `energyMode`:
  - `'strict'`: attempts kinetic-energy preservation after constraints unless residual too high.
  - `'bounded'`: skips strict rescale path.
- Constraints enforced in physics:
  - stick distance
  - line constraints
  - attachment constraints
  - anchor fixing via zero inverse mass
- When enabling physics:
  - store clears tool/selection/edit state,
  - resets velocities to zero,
  - re-projects to satisfy constraints.
  - net effect: scene starts stationary until user drag injects motion.

## Rendering Notes

- Canvas render path is in `/Users/davidbachman/Documents/LinkageApp/src/model/render.ts`.
- Visual spec in current code:
  - background `#f8f8f6`
  - sticks light brown with black outline
  - pivots black dots
  - anchors red circles
  - line constraints blue
  - pen marks as bold X (default purple)
  - selection aura colors for anchor/pivot/pen/stick/line

## Testing Notes

- Run full suite before/after major edits: `npm test`.
- Integration tests inspect hidden debug JSON:
  - `data-testid="scene-debug"`
  - `data-testid="pen-debug"`
  - `data-testid="physics-debug"`
- Do not remove those debug `<pre>` blocks unless tests are updated accordingly.
- Canvas is mocked in `/Users/davidbachman/Documents/LinkageApp/src/test/setup.ts` with recorded draw ops (`__ops`).
- Many behavior regressions are already covered, including:
  - snapping and shift-to-disable snap
  - interior attachment constraints
  - line constraint release
  - physics toggling and momentum injection
  - pen trail lifecycle

## Deployment Notes

- GitHub Pages deploy workflow: `/Users/davidbachman/Documents/LinkageApp/.github/workflows/deploy.yml`.
- App base path is `/Linky/` in `/Users/davidbachman/Documents/LinkageApp/vite.config.ts`.
- If renaming repo or pages path, update `base` accordingly or routing/assets will break.

## Practical Guidance for Future Agents

- Prefer implementing interaction rules in store first, then wiring UI events in canvas.
- Keep `types.ts`, `store.ts`, and tests in sync for any API signature changes.
- If adding new constraints:
  - add to scene model,
  - add hit-testing/selection/editing,
  - include in both drag solver and physics solver paths,
  - add regression tests in store + app integration suites.
- Be careful with physics changes:
  - validate with long-run tests for NaN/runaway behavior,
  - watch `physicsDiagnostics` (`constraintViolation*`, energy flags).
- If changing selection/deletion behavior, update both:
  - store selection logic,
  - App-level delete key handler.
