# Linky

Interactive linkage builder and simulator for creating rigid stick mechanisms with anchors, constraints, and drawing pens.

Live app: [https://davbachman.github.io/Linky/](https://davbachman.github.io/Linky/)

## What You Can Do

- Build mechanisms from rigid sticks and pivots.
- Snap new sticks to existing pivots to create hinges.
- Attach stick endpoints to the interior of other sticks.
- Add anchors (fixed pivots).
- Add/edit/delete line constraints and snap pivots to them.
- Drag pivots to pose or excite the mechanism.
- Toggle physics simulation with `Play`.
- Add pens to pivots and draw trajectories while physics is running.

## User Guide

## Toolbar

- `Stick`: Create sticks and edit selected sticks.
- `Anchor`: Convert an existing pivot to an anchor.
- `Line`: Create and edit blue line constraints.
- `Pen`: Assign/edit pens on non-anchor pivots.
- `Play`: Toggle physics simulation on/off.
- `Clear`: Clear current pen drawing trails.

## Creating and Editing

### Sticks

1. Click `Stick`.
2. Click and drag on the canvas.
3. Release to place the second endpoint.

Behavior:

- Endpoints snap to nearby pivots.
- Endpoints can snap to the interior of an existing stick to create an attachment hinge.
- Endpoints can snap to nearby line constraints.
- Selected stick endpoint drag resizes length (other endpoint stays fixed).
- Press `Delete` with a selected stick to remove it.

### Anchors

1. Click `Anchor`.
2. Click an existing pivot.

Behavior:

- Anchor is shown as a large red point.
- Press `Delete` with a selected anchor to unanchor it.

### Line Constraints

1. Click `Line`.
2. Click-drag-release to draw a blue line.

Behavior:

- Dragging a pivot near a line can snap it to the line.
- A snapped pivot remains constrained to that line until released by a mostly normal drag.
- Click a line to select it.
- Drag line endpoints to edit line position.
- Press `Delete` with a selected line to remove it.

### Pens

1. Click `Pen`.
2. Click a non-anchor pivot to assign/select a pen (shown as an `X`).
3. Right-click a pen marker to open pen options:
   - Change pen color.
   - Enable/disable drawing.

Behavior:

- Pens draw only while physics is enabled.
- Toggling `Play` off keeps existing drawing visible.
- Starting physics again clears old trails and starts a fresh drawing session.
- `Clear` removes current drawing trails without removing pen assignments.
- Press `Delete` with a selected pen to remove that pen assignment.

## Physics Mode

- Click `Play` to enable simulation.
- Click `Play` again to return to edit mode.
- Click and drag a non-anchor pivot to inject motion.
- Anchors remain fixed while physics is enabled.
- Editing tools (`Stick`, `Anchor`, `Line`, `Pen`) are disabled while physics runs.

## Navigation Controls

- Pan:
  - Middle mouse drag, or
  - Hold `Space` + left-drag.
- Zoom: mouse wheel.
- `Shift` while dragging/releasing disables snapping for that action.

## Tips

- Build stable mechanisms by anchoring at least one pivot.
- If dragging feels constrained, check whether the pivot is attached to a line or stick interior.
- Use `Shift` to place or move a point freely without snap behavior.

## GitHub Pages

This repo is configured for GitHub Pages deployment via GitHub Actions.

- Workflow file: `.github/workflows/deploy.yml`
- Vite base path: `/Linky/`

If Pages is enabled for this repository, the app is expected at:

- [https://davbachman.github.io/Linky/](https://davbachman.github.io/Linky/)
