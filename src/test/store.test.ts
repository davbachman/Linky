import { describe, expect, it } from 'vitest';

import { createEmptyScene, createSceneStore, snapOrCreateNode } from '../model/store';
import { distance, distancePointToSegment } from '../model/hitTest';

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

  it('allows physics options updates and returns a defensive diagnostics snapshot', () => {
    const store = createSceneStore();
    store.setPhysicsOptions({
      substeps: 99,
      constraintIterations: 99,
      positionTolerance: -1,
      velocityTolerance: 0,
      integratorMode: 'legacy_projection',
      massModel: 'rigid_stick',
      energyMode: 'bounded'
    });

    const options = store.getState().physicsOptions;
    expect(options.substeps).toBe(16);
    expect(options.constraintIterations).toBe(64);
    expect(options.positionTolerance).toBeGreaterThan(0);
    expect(options.velocityTolerance).toBeGreaterThan(0);
    expect(options.integratorMode).toBe('legacy_projection');
    expect(options.massModel).toBe('rigid_stick');
    expect(options.energyMode).toBe('bounded');

    const diagnostics = store.getPhysicsDiagnostics();
    diagnostics.relativeJointAngleHistory.push(123);
    expect(store.getPhysicsDiagnostics().relativeJointAngleHistory).toHaveLength(0);
    expect(store.getPhysicsDiagnostics().energyRescaleSkippedDueHighResidual).toBe(false);
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

  it('tracks bounded physics diagnostics over time in frictionless mode', () => {
    const store = createSceneStore();
    store.addStick({ x: 0, y: 0 }, { x: 90, y: 0 });
    store.addStick({ x: 90, y: 0 }, { x: 170, y: 45 });

    store.setPhysicsOptions({
      integratorMode: 'rattle_symplectic',
      substeps: 8,
      constraintIterations: 32
    });

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
    const energies: number[] = [];
    const angularMomenta: number[] = [];
    const maxViolations: number[] = [];

    for (let i = 0; i < 160; i += 1) {
      store.stepPhysics(dt);
      const diagnostics = store.getPhysicsDiagnostics();
      energies.push(diagnostics.totalKineticEnergy);
      angularMomenta.push(diagnostics.angularMomentumAboutAnchor);
      maxViolations.push(diagnostics.constraintViolationMax);

      expect(Number.isFinite(diagnostics.totalKineticEnergy)).toBe(true);
      expect(Number.isFinite(diagnostics.angularMomentumAboutAnchor)).toBe(true);
      expect(Number.isFinite(diagnostics.constraintViolationL2)).toBe(true);
      expect(Number.isFinite(diagnostics.constraintViolationMax)).toBe(true);
    }

    const nonZeroEnergies = energies.filter((value) => value > 1e-6);
    expect(nonZeroEnergies.length).toBeGreaterThan(40);
    const peakEnergy = Math.max(...nonZeroEnergies);
    const tailEnergy = nonZeroEnergies[nonZeroEnergies.length - 1];
    expect(tailEnergy).toBeGreaterThan(peakEnergy * 0.35);

    const angularAbsMax = Math.max(...angularMomenta.map((value) => Math.abs(value)));
    expect(angularAbsMax).toBeGreaterThan(1e-3);

    const violationMax = Math.max(...maxViolations);
    expect(violationMax).toBeLessThan(1.25);
  });

  it('supports strict and bounded energy modes during physics stepping', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 140, y: 140 }, { x: 320, y: 140 }).ok).toBe(true);
    expect(store.addStick({ x: 320, y: 140 }, { x: 430, y: 220 }).ok).toBe(true);
    expect(store.beginStick({ x: 240, y: 60 }).ok).toBe(true);
    expect(store.endStick({ x: 228, y: 142 }).ok).toBe(true);

    const setup = store.getState();
    const attachment = Object.values(setup.scene.attachments)[0];
    expect(attachment).toBeDefined();
    const host = setup.scene.sticks[attachment.hostStickId];
    expect(host).toBeDefined();
    const anchorId =
      setup.scene.nodes[host.a].pos.x <= setup.scene.nodes[host.b].pos.x ? host.a : host.b;
    expect(store.setAnchor(anchorId).ok).toBe(true);

    const dragNodeId = Object.keys(setup.scene.nodes)
      .filter((id) => id !== anchorId && !setup.scene.nodes[id].anchored)
      .reduce((best, id) =>
        !best || setup.scene.nodes[id].pos.x > setup.scene.nodes[best].pos.x ? id : best
      , '');
    expect(dragNodeId).toBeDefined();

    store.setPhysicsOptions({
      integratorMode: 'rattle_symplectic',
      substeps: 1,
      constraintIterations: 1,
      energyMode: 'strict'
    });
    store.setPhysicsEnabled(true);
    expect(store.beginDrag(dragNodeId).ok).toBe(true);
    expect(store.updateDrag({ x: setup.scene.nodes[dragNodeId].pos.x + 90, y: setup.scene.nodes[dragNodeId].pos.y + 70 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    let sawStrictSkip = false;
    for (let i = 0; i < 120; i += 1) {
      expect(store.stepPhysics(1 / 60).ok).toBe(true);
      const diagnostics = store.getPhysicsDiagnostics();
      if (diagnostics.energyRescaleSkippedDueHighResidual) {
        sawStrictSkip = true;
      }
    }
    expect(sawStrictSkip).toBe(true);

    store.setPhysicsOptions({ energyMode: 'bounded' });
    for (let i = 0; i < 40; i += 1) {
      expect(store.stepPhysics(1 / 60).ok).toBe(true);
      expect(store.getPhysicsDiagnostics().energyRescaleSkippedDueHighResidual).toBe(false);
    }
  });

  it('remains stable for an anchored A/B pendulum with branch stick C attached to B interior', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 180, y: 120 }, { x: 360, y: 160 }).ok).toBe(true);
    expect(store.addStick({ x: 360, y: 160 }, { x: 500, y: 240 }).ok).toBe(true);
    expect(store.beginStick({ x: 280, y: 40 }).ok).toBe(true);
    expect(store.endStick({ x: 270, y: 140 }).ok).toBe(true);

    const setup = store.getState();
    expect(Object.keys(setup.scene.attachments)).toHaveLength(1);
    const attachment = Object.values(setup.scene.attachments)[0];
    const host = setup.scene.sticks[attachment.hostStickId];
    expect(host).toBeDefined();

    const anchorId =
      setup.scene.nodes[host.a].pos.x <= setup.scene.nodes[host.b].pos.x ? host.a : host.b;
    expect(store.setAnchor(anchorId).ok).toBe(true);
    store.setPhysicsOptions({
      integratorMode: 'rattle_symplectic',
      substeps: 4,
      constraintIterations: 16,
      energyMode: 'strict'
    });
    store.setPhysicsEnabled(true);

    const beforeDrag = store.getState();
    const dragNodeId = Object.keys(beforeDrag.scene.nodes)
      .filter((id) => !beforeDrag.scene.nodes[id].anchored)
      .reduce((best, id) =>
        !best || beforeDrag.scene.nodes[id].pos.x > beforeDrag.scene.nodes[best].pos.x ? id : best
      , '');
    expect(dragNodeId).toBeDefined();

    expect(store.beginDrag(dragNodeId).ok).toBe(true);
    expect(
      store.updateDrag({
        x: beforeDrag.scene.nodes[dragNodeId].pos.x + 100,
        y: beforeDrag.scene.nodes[dragNodeId].pos.y + 60
      }).ok
    ).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    let maxViolation = 0;
    for (let i = 0; i < 1600; i += 1) {
      expect(store.stepPhysics(1 / 60).ok).toBe(true);
      const state = store.getState();
      for (const node of Object.values(state.scene.nodes)) {
        expect(Number.isFinite(node.pos.x)).toBe(true);
        expect(Number.isFinite(node.pos.y)).toBe(true);
        expect(Math.abs(node.pos.x)).toBeLessThan(1e5);
        expect(Math.abs(node.pos.y)).toBeLessThan(1e5);
      }
      const diagnostics = store.getPhysicsDiagnostics();
      maxViolation = Math.max(maxViolation, diagnostics.constraintViolationMax);
    }

    const finalState = store.getState();
    const finalAttachment = finalState.scene.attachments[attachment.id];
    expect(finalAttachment).toBeDefined();
    const finalHost = finalState.scene.sticks[finalAttachment.hostStickId];
    expect(finalHost).toBeDefined();
    const attachedNode = finalState.scene.nodes[finalAttachment.nodeId].pos;
    const hostA = finalState.scene.nodes[finalHost.a].pos;
    const hostB = finalState.scene.nodes[finalHost.b].pos;
    expect(distancePointToSegment(attachedNode, hostA, hostB)).toBeLessThan(0.35);
    expect(maxViolation).toBeLessThan(3);
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

  it('does not snap to a nearby line when snap is disabled during drag', () => {
    const store = createSceneStore();
    store.addStick({ x: 100, y: 120 }, { x: 200, y: 120 });

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);

    const movingId = Object.values(store.getState().scene.nodes).find((node) => node.pos.x > 150)?.id;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 158, y: 165 }, { disableSnap: true }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const after = store.getState().scene.nodes[movingId!];
    expect(after.lineConstraintId).toBeNull();
    expect(Math.abs(after.pos.x - 150)).toBeGreaterThan(1);
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

  it('binds a newly created stick endpoint to a nearby line constraint', () => {
    const store = createSceneStore();

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);

    expect(store.beginStick({ x: 60, y: 110 }).ok).toBe(true);
    expect(store.endStick({ x: 158, y: 118 }).ok).toBe(true);

    const state = store.getState();
    const constrainedNode = Object.values(state.scene.nodes).find((node) => node.lineConstraintId);
    expect(constrainedNode).toBeDefined();
    expect(constrainedNode!.lineConstraintId).toBeDefined();
    expect(constrainedNode!.pos.x).toBeCloseTo(150, 1);
  });

  it('does not snap a new stick endpoint to nearby constraints when snap is disabled on release', () => {
    const store = createSceneStore();

    expect(store.beginLine({ x: 150, y: 40 }).ok).toBe(true);
    expect(store.endLine({ x: 150, y: 220 }).ok).toBe(true);

    expect(store.beginStick({ x: 60, y: 110 }).ok).toBe(true);
    expect(store.endStick({ x: 158, y: 118 }, { disableSnap: true }).ok).toBe(true);

    const state = store.getState();
    const constrainedNode = Object.values(state.scene.nodes).find((node) => node.lineConstraintId);
    expect(constrainedNode).toBeUndefined();

    const endpoint = Object.values(state.scene.nodes).reduce((best, node) => {
      if (!best) {
        return node;
      }
      return distance(node.pos, { x: 158, y: 118 }) < distance(best.pos, { x: 158, y: 118 }) ? node : best;
    }, null as (typeof state.scene.nodes)[string] | null);
    expect(endpoint).toBeDefined();
    expect(endpoint!.pos.x).toBeCloseTo(158, 1);
    expect(endpoint!.pos.y).toBeCloseTo(118, 1);
  });

  it('creates a hinge when a new stick endpoint lands on the interior of an existing stick', () => {
    const store = createSceneStore();

    expect(store.addStick({ x: 100, y: 100 }, { x: 300, y: 100 }).ok).toBe(true);
    expect(store.beginStick({ x: 80, y: 220 }).ok).toBe(true);
    expect(store.endStick({ x: 205, y: 108 }).ok).toBe(true);

    const state = store.getState();
    expect(Object.keys(state.scene.sticks)).toHaveLength(2);
    expect(Object.keys(state.scene.attachments)).toHaveLength(1);
    const attachment = Object.values(state.scene.attachments)[0];
    expect(attachment).toBeDefined();
    const hingeNode = state.scene.nodes[attachment.nodeId];
    expect(hingeNode).toBeDefined();
    expect(hingeNode.pos.y).toBeCloseTo(100, 1);
  });

  it('creates a hinge when moving a stick endpoint onto the interior of another stick', () => {
    const store = createSceneStore();

    expect(store.addStick({ x: 100, y: 120 }, { x: 320, y: 120 }).ok).toBe(true);
    expect(store.addStick({ x: 60, y: 210 }, { x: 120, y: 260 }).ok).toBe(true);

    expect(store.tryHandleStickToolClick({ x: 90, y: 235 }).ok).toBe(true);
    expect(store.tryBeginSelectedStickResizeAt({ x: 120, y: 260 }).ok).toBe(true);
    expect(store.updateSelectedStickResize({ x: 212, y: 124 }).ok).toBe(true);
    expect(store.endSelectedStickResize().ok).toBe(true);

    const state = store.getState();
    expect(Object.keys(state.scene.sticks)).toHaveLength(2);
    expect(Object.keys(state.scene.attachments)).toHaveLength(1);
    const attachment = Object.values(state.scene.attachments)[0];
    expect(attachment).toBeDefined();
    const hingeNode = state.scene.nodes[attachment.nodeId];
    expect(hingeNode).toBeDefined();
    expect(hingeNode.pos.y).toBeCloseTo(120, 1);
  });

  it('does not create an interior hinge when snap is disabled while resizing a stick endpoint', () => {
    const store = createSceneStore();

    expect(store.addStick({ x: 100, y: 120 }, { x: 320, y: 120 }).ok).toBe(true);
    expect(store.addStick({ x: 60, y: 210 }, { x: 120, y: 260 }).ok).toBe(true);

    expect(store.tryHandleStickToolClick({ x: 90, y: 235 }).ok).toBe(true);
    expect(store.tryBeginSelectedStickResizeAt({ x: 120, y: 260 }).ok).toBe(true);
    expect(store.updateSelectedStickResize({ x: 212, y: 124 }).ok).toBe(true);
    expect(store.endSelectedStickResize({ disableSnap: true }).ok).toBe(true);

    const state = store.getState();
    expect(Object.keys(state.scene.attachments)).toHaveLength(0);
  });

  it('keeps an interior attachment hinge centered on the host stick during motion', () => {
    const store = createSceneStore();

    expect(store.addStick({ x: 100, y: 120 }, { x: 320, y: 120 }).ok).toBe(true);
    expect(store.addStick({ x: 200, y: 210 }, { x: 260, y: 280 }).ok).toBe(true);

    expect(store.tryHandleStickToolClick({ x: 230, y: 245 }).ok).toBe(true);
    expect(store.tryBeginSelectedStickResizeAt({ x: 260, y: 280 }).ok).toBe(true);
    expect(store.updateSelectedStickResize({ x: 212, y: 124 }).ok).toBe(true);
    expect(store.endSelectedStickResize().ok).toBe(true);

    const afterAttach = store.getState();
    const attachment = Object.values(afterAttach.scene.attachments)[0];
    expect(attachment).toBeDefined();

    const host = afterAttach.scene.sticks[attachment.hostStickId];
    expect(host).toBeDefined();
    const hingeId = attachment.nodeId;
    expect(hingeId).toBeDefined();

    const movingStick = Object.values(afterAttach.scene.sticks).find(
      (stick) => stick.visible !== false && (stick.a === hingeId || stick.b === hingeId)
    );
    expect(movingStick).toBeDefined();
    const movingId = movingStick!.a === hingeId ? movingStick!.b : movingStick!.a;
    expect(movingId).toBeDefined();

    expect(store.beginDrag(movingId).ok).toBe(true);
    expect(store.updateDrag({ x: 260, y: 330 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const finalState = store.getState();
    const finalHost = finalState.scene.sticks[host.id];
    const hingePos = finalState.scene.nodes[hingeId!].pos;
    const hostA = finalState.scene.nodes[finalHost.a].pos;
    const hostB = finalState.scene.nodes[finalHost.b].pos;
    const offset = distancePointToSegment(hingePos, hostA, hostB);
    expect(offset).toBeLessThan(0.25);
  });

  it('allows responsive dragging of a leaf endpoint after interior attachment with anchors present', () => {
    const store = createSceneStore();

    expect(store.addStick({ x: 100, y: 120 }, { x: 320, y: 120 }).ok).toBe(true);
    const hostLeft = Object.keys(store.getState().scene.nodes).find(
      (id) => store.getState().scene.nodes[id].pos.x === 100
    );
    expect(hostLeft).toBeDefined();
    expect(store.setAnchor(hostLeft!).ok).toBe(true);

    expect(store.beginStick({ x: 250, y: 300 }).ok).toBe(true);
    expect(store.endStick({ x: 210, y: 124 }).ok).toBe(true);

    const before = store.getState();
    const leafNodeId = Object.keys(before.scene.nodes).reduce((best, id) => {
      if (!best) {
        return id;
      }
      return before.scene.nodes[id].pos.y > before.scene.nodes[best].pos.y ? id : best;
    }, '');
    const beforeLeaf = { ...before.scene.nodes[leafNodeId].pos };

    expect(store.beginDrag(leafNodeId).ok).toBe(true);
    expect(store.updateDrag({ x: beforeLeaf.x + 45, y: beforeLeaf.y - 35 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);

    const afterLeaf = store.getState().scene.nodes[leafNodeId].pos;
    expect(distance(afterLeaf, beforeLeaf)).toBeGreaterThan(25);
  });

  it('assigns pens only to non-anchor pivots and supports hit testing', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 100, y: 100 }, { x: 220, y: 100 }).ok).toBe(true);

    const state = store.getState();
    const leftId = Object.keys(state.scene.nodes).find((id) => state.scene.nodes[id].pos.x < 160);
    const rightId = Object.keys(state.scene.nodes).find((id) => state.scene.nodes[id].pos.x > 160);
    expect(leftId).toBeDefined();
    expect(rightId).toBeDefined();

    expect(store.setAnchor(leftId!).ok).toBe(true);
    expect(store.setPen(leftId!).ok).toBe(false);
    expect(store.setPen(rightId!).ok).toBe(true);

    const after = store.getState();
    expect(after.pens[rightId!].color).toBe('#7b3fe4');
    expect(after.pens[rightId!].enabled).toBe(true);
    expect(store.hitTestPen({ x: after.scene.nodes[rightId!].pos.x, y: after.scene.nodes[rightId!].pos.y })).toBe(
      rightId
    );
  });

  it('persists pen trails on stop and resets them on the next play', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 100, y: 100 }, { x: 220, y: 100 }).ok).toBe(true);

    const movingId = Object.keys(store.getState().scene.nodes).find(
      (id) => store.getState().scene.nodes[id].pos.x > 160
    );
    expect(movingId).toBeDefined();
    expect(store.setPen(movingId!).ok).toBe(true);

    store.setPhysicsEnabled(true);
    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 265, y: 140 }).ok).toBe(true);
    expect(store.updateDrag({ x: 280, y: 165 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.stepPhysics(1 / 60).ok).toBe(true);

    const duringPlayPoints =
      store.getState().penTrails[movingId!]?.reduce((sum, stroke) => sum + stroke.points.length, 0) ?? 0;
    expect(duringPlayPoints).toBeGreaterThan(2);

    store.setPhysicsEnabled(false);
    const afterStopPoints =
      store.getState().penTrails[movingId!]?.reduce((sum, stroke) => sum + stroke.points.length, 0) ?? 0;
    expect(afterStopPoints).toBe(duringPlayPoints);

    store.setPhysicsEnabled(true);
    const afterReplayPoints =
      store.getState().penTrails[movingId!]?.reduce((sum, stroke) => sum + stroke.points.length, 0) ?? 0;
    expect(afterReplayPoints).toBeLessThan(duringPlayPoints);
    expect(afterReplayPoints).toBeLessThanOrEqual(1);
  });

  it('clears pen trails with clearDrawing while keeping pens assigned', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 100, y: 100 }, { x: 220, y: 100 }).ok).toBe(true);

    const movingId = Object.keys(store.getState().scene.nodes).find(
      (id) => store.getState().scene.nodes[id].pos.x > 160
    );
    expect(movingId).toBeDefined();
    expect(store.setPen(movingId!).ok).toBe(true);

    store.setPhysicsEnabled(true);
    expect(store.beginDrag(movingId!).ok).toBe(true);
    expect(store.updateDrag({ x: 260, y: 150 }).ok).toBe(true);
    expect(store.endDrag().ok).toBe(true);
    expect(store.stepPhysics(1 / 60).ok).toBe(true);

    const beforeClearPoints =
      store.getState().penTrails[movingId!]?.reduce((sum, stroke) => sum + stroke.points.length, 0) ?? 0;
    expect(beforeClearPoints).toBeGreaterThan(1);

    store.clearDrawing();
    const after = store.getState();
    expect(after.pens[movingId!]).toBeDefined();
    expect(after.penTrails[movingId!]).toBeUndefined();
  });

  it('deletes a selected pen without deleting the pivot or sticks', () => {
    const store = createSceneStore();
    expect(store.addStick({ x: 100, y: 100 }, { x: 220, y: 100 }).ok).toBe(true);

    const state = store.getState();
    const penNodeId = Object.keys(state.scene.nodes).find((id) => state.scene.nodes[id].pos.x > 160);
    expect(penNodeId).toBeDefined();

    const beforeNodeCount = Object.keys(state.scene.nodes).length;
    const beforeStickCount = Object.keys(state.scene.sticks).length;
    expect(store.setPen(penNodeId!).ok).toBe(true);
    expect(store.getState().selection.penNodeId).toBe(penNodeId);

    expect(store.deleteSelectedPen().ok).toBe(true);

    const after = store.getState();
    expect(after.pens[penNodeId!]).toBeUndefined();
    expect(after.penTrails[penNodeId!]).toBeUndefined();
    expect(after.selection.penNodeId).toBeNull();
    expect(Object.keys(after.scene.nodes)).toHaveLength(beforeNodeCount);
    expect(Object.keys(after.scene.sticks)).toHaveLength(beforeStickCount);
  });

});
