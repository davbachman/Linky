import { describe, expect, it } from 'vitest';

import { createEmptyScene, createSceneStore, snapOrCreateNode } from '../model/store';
import { distance } from '../model/hitTest';

describe('store helpers', () => {
  it('snapOrCreateNode reuses existing node in snap radius and creates node outside radius', () => {
    const scene = createEmptyScene();
    let idCounter = 0;

    const idFactory = () => {
      idCounter += 1;
      return `node-${idCounter}`;
    };

    const first = snapOrCreateNode(scene, { x: 10, y: 10 }, 12, idFactory);
    const snapped = snapOrCreateNode(scene, { x: 17, y: 12 }, 12, idFactory);
    const created = snapOrCreateNode(scene, { x: 80, y: 80 }, 12, idFactory);

    expect(first.created).toBe(true);
    expect(snapped.created).toBe(false);
    expect(snapped.nodeId).toBe(first.nodeId);
    expect(created.created).toBe(true);
    expect(created.nodeId).not.toBe(first.nodeId);
    expect(Object.keys(scene.nodes)).toHaveLength(2);
  });
});

describe('createSceneStore', () => {
  it('addStick stores the correct rest length', () => {
    const store = createSceneStore();

    const result = store.addStick({ x: 10, y: 20 }, { x: 110, y: 20 });
    expect(result.ok).toBe(true);

    const state = store.getState();
    const stick = Object.values(state.scene.sticks)[0];
    expect(stick.restLength).toBeCloseTo(100, 6);
  });

  it('keeps anchors fixed while dragging a non-anchor pivot', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });

    const state = store.getState();
    const ids = Object.keys(state.scene.nodes);
    const anchorId = ids[0];
    const dragId = ids[1];

    store.setAnchor(anchorId);
    const beforeAnchorPos = { ...state.scene.nodes[anchorId].pos };

    const begin = store.beginDrag(dragId);
    expect(begin.ok).toBe(true);
    store.updateDrag({ x: 50, y: 50 });
    store.endDrag();

    const afterState = store.getState();
    const anchor = afterState.scene.nodes[anchorId];
    const drag = afterState.scene.nodes[dragId];
    const stick = Object.values(afterState.scene.sticks)[0];

    expect(anchor.pos.x).toBeCloseTo(beforeAnchorPos.x, 6);
    expect(anchor.pos.y).toBeCloseTo(beforeAnchorPos.y, 6);
    expect(distance(anchor.pos, drag.pos)).toBeCloseTo(stick.restLength, 1);
  });

  it('keeps stick length rigid when dragging an anchor pivot', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });

    const state = store.getState();
    const ids = Object.keys(state.scene.nodes);
    const anchorId = ids[0];
    const otherId = ids[1];

    const beforeAnchorPos = { ...state.scene.nodes[anchorId].pos };
    const beforeOtherPos = { ...state.scene.nodes[otherId].pos };

    store.setAnchor(anchorId);
    const begin = store.beginDrag(anchorId);
    expect(begin.ok).toBe(true);
    store.updateDrag({ x: 50, y: 50 });
    store.endDrag();

    const afterState = store.getState();
    const anchored = afterState.scene.nodes[anchorId];
    const other = afterState.scene.nodes[otherId];
    const stick = Object.values(afterState.scene.sticks)[0];

    expect(anchored.anchored).toBe(true);
    expect(anchored.pos.x).not.toBeCloseTo(beforeAnchorPos.x, 4);
    expect(anchored.pos.y).not.toBeCloseTo(beforeAnchorPos.y, 4);
    expect(other.pos.x).not.toBeCloseTo(beforeOtherPos.x, 4);
    expect(other.pos.y).not.toBeCloseTo(beforeOtherPos.y, 4);
    expect(distance(anchored.pos, other.pos)).toBeCloseTo(stick.restLength, 1);
  });

  it('keeps both sticks rigid while dragging a shared pivot', () => {
    const store = createSceneStore();
    store.addStick({ x: 100, y: 100 }, { x: 220, y: 100 });
    store.addStick({ x: 220, y: 100 }, { x: 280, y: 190 });

    const state = store.getState();
    const degrees: Record<string, number> = {};
    for (const nodeId of Object.keys(state.scene.nodes)) {
      degrees[nodeId] = 0;
    }
    for (const stick of Object.values(state.scene.sticks)) {
      degrees[stick.a] += 1;
      degrees[stick.b] += 1;
    }

    const sharedPivotId = Object.keys(degrees).find((nodeId) => degrees[nodeId] >= 2);
    expect(sharedPivotId).toBeDefined();

    const begin = store.beginDrag(sharedPivotId!);
    expect(begin.ok).toBe(true);
    store.updateDrag({ x: 240, y: 140 });
    store.endDrag();

    const afterState = store.getState();
    for (const stick of Object.values(afterState.scene.sticks)) {
      const a = afterState.scene.nodes[stick.a].pos;
      const b = afterState.scene.nodes[stick.b].pos;
      expect(distance(a, b)).toBeCloseTo(stick.restLength, 1);
    }
  });

  it('stops a dragged pivot at the reachable boundary instead of stretching sticks', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 50, y: 80 });
    store.addStick({ x: 100, y: 0 }, { x: 50, y: 80 });

    const state = store.getState();
    const nodeIds = Object.keys(state.scene.nodes);
    const leftAnchorId = nodeIds.find((id) => Math.abs(state.scene.nodes[id].pos.x - 0) < 0.001);
    const rightAnchorId = nodeIds.find((id) => Math.abs(state.scene.nodes[id].pos.x - 100) < 0.001);
    const draggedId = nodeIds.find((id) => id !== leftAnchorId && id !== rightAnchorId);

    expect(leftAnchorId).toBeDefined();
    expect(rightAnchorId).toBeDefined();
    expect(draggedId).toBeDefined();

    store.setAnchor(leftAnchorId!);
    store.setAnchor(rightAnchorId!);

    const before = store.getState();
    const beforeDragged = { ...before.scene.nodes[draggedId!].pos };
    const restByStickId: Record<string, number> = {};
    for (const stick of Object.values(before.scene.sticks)) {
      restByStickId[stick.id] = stick.restLength;
    }

    const begin = store.beginDrag(draggedId!);
    expect(begin.ok).toBe(true);
    store.updateDrag({ x: 300, y: 80 });
    store.endDrag();

    const after = store.getState();
    const afterDragged = after.scene.nodes[draggedId!].pos;
    expect(afterDragged.x).toBeCloseTo(beforeDragged.x, 0);
    expect(afterDragged.y).toBeCloseTo(beforeDragged.y, 0);

    for (const stick of Object.values(after.scene.sticks)) {
      const a = after.scene.nodes[stick.a].pos;
      const b = after.scene.nodes[stick.b].pos;
      expect(distance(a, b)).toBeCloseTo(restByStickId[stick.id], 1);
    }
  });

  it('allows moving pivots adjacent to anchors while keeping sticks rigid', () => {
    const store = createSceneStore();
    store.addStick({ x: 40, y: 160 }, { x: 150, y: 90 });
    store.addStick({ x: 150, y: 90 }, { x: 230, y: 230 });
    store.addStick({ x: 230, y: 230 }, { x: 320, y: 90 });
    store.addStick({ x: 320, y: 90 }, { x: 440, y: 150 });

    const initial = store.getState();
    const nodeIds = Object.keys(initial.scene.nodes);
    const leftAnchorId = nodeIds.reduce((best, id) =>
      initial.scene.nodes[id].pos.x < initial.scene.nodes[best].pos.x ? id : best
    );
    const rightAnchorId = nodeIds.reduce((best, id) =>
      initial.scene.nodes[id].pos.x > initial.scene.nodes[best].pos.x ? id : best
    );

    store.setAnchor(leftAnchorId);
    store.setAnchor(rightAnchorId);

    const stateAfterAnchor = store.getState();
    const adjacentLeftId = Object.values(stateAfterAnchor.scene.sticks).find(
      (stick) => stick.a === leftAnchorId || stick.b === leftAnchorId
    );
    const adjacentRightId = Object.values(stateAfterAnchor.scene.sticks).find(
      (stick) => stick.a === rightAnchorId || stick.b === rightAnchorId
    );
    expect(adjacentLeftId).toBeDefined();
    expect(adjacentRightId).toBeDefined();

    const leftMovableId =
      adjacentLeftId!.a === leftAnchorId ? adjacentLeftId!.b : adjacentLeftId!.a;
    const rightMovableId =
      adjacentRightId!.a === rightAnchorId ? adjacentRightId!.b : adjacentRightId!.a;

    const beforeLeft = { ...stateAfterAnchor.scene.nodes[leftMovableId].pos };
    const beginLeft = store.beginDrag(leftMovableId);
    expect(beginLeft.ok).toBe(true);
    store.updateDrag({ x: beforeLeft.x + 14, y: beforeLeft.y - 10 });
    store.endDrag();

    const afterLeftState = store.getState();
    const afterLeft = afterLeftState.scene.nodes[leftMovableId].pos;
    expect(afterLeft.x).not.toBeCloseTo(beforeLeft.x, 3);
    expect(afterLeft.y).not.toBeCloseTo(beforeLeft.y, 3);

    const beforeRight = { ...afterLeftState.scene.nodes[rightMovableId].pos };
    const beginRight = store.beginDrag(rightMovableId);
    expect(beginRight.ok).toBe(true);
    store.updateDrag({ x: beforeRight.x - 16, y: beforeRight.y - 8 });
    store.endDrag();

    const finalState = store.getState();
    const afterRight = finalState.scene.nodes[rightMovableId].pos;
    expect(afterRight.x).not.toBeCloseTo(beforeRight.x, 3);
    expect(afterRight.y).not.toBeCloseTo(beforeRight.y, 3);

    for (const stick of Object.values(finalState.scene.sticks)) {
      const a = finalState.scene.nodes[stick.a].pos;
      const b = finalState.scene.nodes[stick.b].pos;
      expect(distance(a, b)).toBeCloseTo(stick.restLength, 1);
    }
  });

  it('locks anchor/stick editing while physics is enabled', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });
    store.setTool('stick');

    store.setPhysicsEnabled(true);
    expect(store.getState().physics.enabled).toBe(true);
    expect(store.getState().tool).toBe('idle');

    store.setTool('anchor');
    expect(store.getState().tool).toBe('idle');

    const addResult = store.addStick({ x: 100, y: 100 }, { x: 180, y: 100 });
    expect(addResult.ok).toBe(false);
  });

  it('keeps anchors fixed against user drag while physics is enabled', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });
    const ids = Object.keys(store.getState().scene.nodes);
    const anchorId = ids[0];

    store.setAnchor(anchorId);
    store.setPhysicsEnabled(true);

    const begin = store.beginDrag(anchorId);
    expect(begin.ok).toBe(false);
  });

  it('advances linkage with momentum when physics is enabled', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });
    const state = store.getState();
    const ids = Object.keys(state.scene.nodes);
    const movingId = ids[0];

    store.setPhysicsEnabled(true);
    expect(store.beginDrag(movingId).ok).toBe(true);
    store.updateDrag({ x: 120, y: 40 });
    store.updateDrag({ x: 150, y: 70 });
    store.endDrag();

    const before = { ...store.getState().scene.nodes[movingId].pos };
    const stepResult = store.stepPhysics(1 / 60);
    expect(stepResult.ok).toBe(true);
    const after = store.getState().scene.nodes[movingId].pos;

    expect(after.x).not.toBeCloseTo(before.x, 4);
    expect(after.y).not.toBeCloseTo(before.y, 4);
  });

  it('maintains momentum over time in physics mode without friction', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 90, y: 0 });
    store.addStick({ x: 90, y: 0 }, { x: 170, y: 45 });

    const nodeIds = Object.keys(store.getState().scene.nodes);
    const anchorId = nodeIds.find((id) => store.getState().scene.nodes[id].pos.x === 0);
    const tipId = nodeIds.reduce((best, id) =>
      store.getState().scene.nodes[id].pos.x > store.getState().scene.nodes[best].pos.x ? id : best
    );
    expect(anchorId).toBeDefined();
    expect(tipId).toBeDefined();

    store.setAnchor(anchorId!);
    store.setPhysicsEnabled(true);

    expect(store.beginDrag(tipId).ok).toBe(true);
    store.updateDrag({ x: 200, y: 95 });
    store.updateDrag({ x: 220, y: 130 });
    store.endDrag();

    const dt = 1 / 60;
    let previousPositions = Object.fromEntries(
      Object.entries(store.getState().scene.nodes).map(([id, node]) => [id, { ...node.pos }])
    );
    const speedSeries: number[] = [];

    for (let i = 0; i < 160; i += 1) {
      store.stepPhysics(dt);
      const current = store.getState().scene.nodes;
      let speedSq = 0;
      for (const [id, node] of Object.entries(current)) {
        if (node.anchored) {
          continue;
        }
        const prev = previousPositions[id];
        const dx = node.pos.x - prev.x;
        const dy = node.pos.y - prev.y;
        speedSq += (dx * dx + dy * dy) / (dt * dt);
      }
      speedSeries.push(speedSq);
      previousPositions = Object.fromEntries(
        Object.entries(current).map(([id, node]) => [id, { ...node.pos }])
      );
    }

    const early = speedSeries.slice(10, 40);
    const late = speedSeries.slice(120, 150);
    const earlyAvg = early.reduce((sum, v) => sum + v, 0) / early.length;
    const lateAvg = late.reduce((sum, v) => sum + v, 0) / late.length;

    expect(earlyAvg).toBeGreaterThan(0.001);
    expect(lateAvg).toBeGreaterThan(earlyAvg * 0.75);
    expect(lateAvg).toBeLessThan(earlyAvg * 1.35);
  });

  it('starts stationary after enabling physics until user drags in physics mode', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 100, y: 0 });
    store.addStick({ x: 100, y: 0 }, { x: 200, y: 0 });

    const initial = store.getState();
    const nodeIds = Object.keys(initial.scene.nodes);
    const leftId = nodeIds.find((id) => initial.scene.nodes[id].pos.x === 0);
    const rightId = nodeIds.find((id) => initial.scene.nodes[id].pos.x === 200);
    const centerId = nodeIds.find((id) => id !== leftId && id !== rightId);
    expect(leftId).toBeDefined();
    expect(rightId).toBeDefined();
    expect(centerId).toBeDefined();

    store.setAnchor(leftId!);
    store.setAnchor(rightId!);

    store.setTool('stick');
    expect(store.tryHandleStickToolClick({ x: 50, y: 0 }).ok).toBe(true);
    expect(store.tryBeginSelectedStickResizeAt({ x: 100, y: 0 }).ok).toBe(true);
    expect(store.updateSelectedStickResize({ x: 120, y: 40 }).ok).toBe(true);
    expect(store.endSelectedStickResize().ok).toBe(true);
    store.setTool('idle');

    store.setPhysicsEnabled(true);
    const afterEnable = Object.fromEntries(
      Object.entries(store.getState().scene.nodes).map(([id, node]) => [id, { ...node.pos }])
    );

    for (let i = 0; i < 120; i += 1) {
      store.stepPhysics(1 / 60);
    }

    const afterSteps = store.getState().scene.nodes;
    for (const [id, node] of Object.entries(afterSteps)) {
      expect(node.pos.x).toBeCloseTo(afterEnable[id].x, 3);
      expect(node.pos.y).toBeCloseTo(afterEnable[id].y, 3);
    }

    // Stationary verification is the key behavior here; momentum injection is
    // covered by dedicated physics momentum tests above.
    expect(store.beginDrag(centerId!).ok).toBe(true);
    store.endDrag();
  });

  it('keeps a line-constrained pivot constrained under mostly tangential dragging', () => {
    const store = createSceneStore();
    store.addStick({ x: 100, y: 120 }, { x: 200, y: 120 });

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.updateLinePreview({ x: 150, y: 220 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);

    const state = store.getState();
    const movingId = Object.values(state.scene.nodes).find((node) => node.pos.x > 150)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 158, y: 165 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const afterSnap = store.getState();
    const snapped = afterSnap.scene.nodes[movingId!];
    expect(snapped.lineConstraintId).toBeDefined();
    expect(snapped.pos.x).toBeCloseTo(150, 3);

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 154, y: 240 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const afterSecondDrag = store.getState().scene.nodes[movingId!];
    expect(afterSecondDrag.pos.x).toBeCloseTo(150, 3);
  });

  it('releases a line-constrained pivot when dragged mostly normal to the line', () => {
    const store = createSceneStore();
    store.addStick({ x: 100, y: 120 }, { x: 200, y: 120 });

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);

    const movingId = Object.values(store.getState().scene.nodes).find((node) => node.pos.x > 150)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 158, y: 165 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.getState().scene.nodes[movingId!].lineConstraintId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 230, y: 165 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const released = store.getState().scene.nodes[movingId!];
    expect(released.lineConstraintId).toBeNull();
    expect(released.pos.x).toBeGreaterThan(170);
  });

  it('clears node constraints when a selected line is deleted', () => {
    const store = createSceneStore();
    store.addStick({ x: 100, y: 120 }, { x: 200, y: 120 });

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);
    const lineId = Object.keys(store.getState().scene.lines)[0];
    expect(lineId).toBeDefined();

    const movingId = Object.values(store.getState().scene.nodes).find((node) => node.pos.x > 150)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 158, y: 165 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.getState().scene.nodes[movingId!].lineConstraintId).toBe(lineId);

    store.setTool('line');
    expect(store.tryHandleLineToolClick({ x: 150, y: 130 }).ok).toBe(true);
    expect(store.deleteSelectedLine().ok).toBe(true);

    const afterDelete = store.getState();
    expect(Object.keys(afterDelete.scene.lines)).toHaveLength(0);
    expect(afterDelete.scene.nodes[movingId!].lineConstraintId).toBeNull();
  });

  it('keeps a circle-constrained pivot constrained under mostly tangential dragging', () => {
    const store = createSceneStore();
    store.addStick({ x: 240, y: 220 }, { x: 340, y: 220 });

    expect(store.beginCircle({ x: 220, y: 220 }).ok).toBe(true);
    expect(store.updateCirclePreview({ x: 300, y: 220 }).ok).toBe(true);
    expect(store.endCircle({ x: 300, y: 220 }).ok).toBe(true);

    const state = store.getState();
    const movingId = Object.values(state.scene.nodes).find((node) => node.pos.x > 300)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 298, y: 222 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const afterSnap = store.getState();
    const snapped = afterSnap.scene.nodes[movingId!];
    const circle = Object.values(afterSnap.scene.circles)[0];
    expect(snapped.circleConstraintId).toBeDefined();
    expect(Math.abs(distance(snapped.pos, circle.center) - circle.radius)).toBeLessThan(0.8);

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 302, y: 305 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const afterSecondDrag = store.getState().scene.nodes[movingId!];
    const circleAfter = Object.values(store.getState().scene.circles)[0];
    expect(Math.abs(distance(afterSecondDrag.pos, circleAfter.center) - circleAfter.radius)).toBeLessThan(
      0.8
    );
  });

  it('releases a circle-constrained pivot when dragged mostly normal to the circle', () => {
    const store = createSceneStore();
    store.addStick({ x: 240, y: 220 }, { x: 340, y: 220 });

    expect(store.beginCircle({ x: 220, y: 220 }).ok).toBe(true);
    expect(store.endCircle({ x: 300, y: 220 }).ok).toBe(true);

    const movingId = Object.values(store.getState().scene.nodes).find((node) => node.pos.x > 300)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 298, y: 222 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.getState().scene.nodes[movingId!].circleConstraintId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 420, y: 220 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const after = store.getState();
    const released = after.scene.nodes[movingId!];
    const circle = Object.values(after.scene.circles)[0];
    expect(released.circleConstraintId).toBeNull();
    expect(Math.abs(distance(released.pos, circle.center) - circle.radius)).toBeGreaterThan(10);
  });

  it('clears node constraints when a selected circle is deleted', () => {
    const store = createSceneStore();
    store.addStick({ x: 240, y: 220 }, { x: 340, y: 220 });

    expect(store.beginCircle({ x: 220, y: 220 }).ok).toBe(true);
    expect(store.endCircle({ x: 300, y: 220 }).ok).toBe(true);
    const circleId = Object.keys(store.getState().scene.circles)[0];
    expect(circleId).toBeDefined();

    const movingId = Object.values(store.getState().scene.nodes).find((node) => node.pos.x > 300)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 298, y: 222 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.getState().scene.nodes[movingId!].circleConstraintId).toBe(circleId);

    store.setTool('circle');
    expect(store.tryHandleCircleToolClick({ x: 300, y: 220 }).ok).toBe(true);
    expect(store.deleteSelectedCircle().ok).toBe(true);

    const afterDelete = store.getState();
    expect(Object.keys(afterDelete.scene.circles)).toHaveLength(0);
    expect(afterDelete.scene.nodes[movingId!].circleConstraintId).toBeNull();
  });
});
