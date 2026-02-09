import {
  DEFAULT_CIRCLE_HANDLE_HIT_RADIUS,
  DEFAULT_CIRCLE_HIT_RADIUS,
  DEFAULT_LINE_ENDPOINT_HIT_RADIUS,
  DEFAULT_LINE_HIT_RADIUS,
  DEFAULT_PIVOT_HIT_RADIUS,
  DEFAULT_SNAP_RADIUS,
  DEFAULT_STICK_HIT_RADIUS,
  distance,
  distancePointToCircle,
  hitTestLine,
  hitTestCircle,
  hitTestCircleCenter,
  hitTestCircleRadiusHandle,
  hitTestLineEndpoint,
  hitTestPivot,
  hitTestStick,
  projectPointToCircle,
  projectPointToInfiniteLine
} from './hitTest';
import {
  DEFAULT_SOLVER_OPTIONS,
  getConnectedComponent,
  projectDragDeltaToConstraintSubspace,
  solveComponentPositions
} from './solver';
import type { Result, Scene, SceneStore, SceneStoreState, Vec2 } from './types';

export const MIN_STICK_LENGTH = 6;
export const SNAP_RADIUS = DEFAULT_SNAP_RADIUS;
export const PIVOT_HIT_RADIUS = DEFAULT_PIVOT_HIT_RADIUS;
export const STICK_HIT_RADIUS = DEFAULT_STICK_HIT_RADIUS;
export const STICK_ENDPOINT_HIT_RADIUS = 12;
export const LINE_HIT_RADIUS = DEFAULT_LINE_HIT_RADIUS;
export const LINE_ENDPOINT_HIT_RADIUS = DEFAULT_LINE_ENDPOINT_HIT_RADIUS;
export const LINE_SNAP_RADIUS = 12;
export const MIN_LINE_LENGTH = 8;
export const CIRCLE_HIT_RADIUS = DEFAULT_CIRCLE_HIT_RADIUS;
export const CIRCLE_HANDLE_HIT_RADIUS = DEFAULT_CIRCLE_HANDLE_HIT_RADIUS;
export const CIRCLE_SNAP_RADIUS = 12;
export const MIN_CIRCLE_RADIUS = 6;
const CONSTRAINED_SOLVER_MIN_ITERATIONS = 500;
const CONSTRAINED_SOLVER_TOLERANCE_PX = 0.005;
const PHYSICS_CONSTRAINT_ITERATIONS = 30;
const PHYSICS_MAX_STEP_SECONDS = 1 / 120;
const DRAG_VELOCITY_MIN_DT_SECONDS = 1 / 240;
const PHYSICS_ENERGY_EPSILON = 1e-9;

export type SnapResult = {
  nodeId: string;
  created: boolean;
};

export function createEmptyScene(): Scene {
  return {
    nodes: {},
    sticks: {},
    lines: {},
    circles: {}
  };
}

export function snapOrCreateNode(
  scene: Scene,
  point: Vec2,
  snapRadius: number,
  nodeIdFactory: () => string
): SnapResult {
  const snappedNodeId = hitTestPivot(scene.nodes, point, snapRadius);
  if (snappedNodeId) {
    return { nodeId: snappedNodeId, created: false };
  }

  const nodeId = nodeIdFactory();
  scene.nodes[nodeId] = {
    id: nodeId,
    pos: { x: point.x, y: point.y },
    anchored: false,
    lineConstraintId: null,
    circleConstraintId: null
  };

  return { nodeId, created: true };
}

function nodeHasAnySticks(scene: Scene, nodeId: string): boolean {
  for (const stick of Object.values(scene.sticks)) {
    if (stick.a === nodeId || stick.b === nodeId) {
      return true;
    }
  }
  return false;
}

function removeNodeIfIsolated(scene: Scene, nodeId: string): void {
  const node = scene.nodes[nodeId];
  if (!node) {
    return;
  }
  if (node.anchored) {
    return;
  }
  if (!nodeHasAnySticks(scene, nodeId)) {
    delete scene.nodes[nodeId];
  }
}

function clearCreateStickState(state: SceneStoreState): void {
  state.createStick.startNodeId = null;
  state.createStick.previewEnd = null;
}

function clearAnchorSelection(state: SceneStoreState): void {
  state.selection.anchorNodeId = null;
}

function clearStickSelection(state: SceneStoreState): void {
  state.selection.stickId = null;
}

function clearStickResize(state: SceneStoreState): void {
  state.stickResize.active = false;
  state.stickResize.stickId = null;
  state.stickResize.fixedNodeId = null;
  state.stickResize.movingNodeId = null;
}

function clearLineCreateState(state: SceneStoreState): void {
  state.createLine.start = null;
  state.createLine.previewEnd = null;
}

function clearLineSelection(state: SceneStoreState): void {
  state.selection.lineId = null;
}

function clearLineResize(state: SceneStoreState): void {
  state.lineResize.active = false;
  state.lineResize.lineId = null;
  state.lineResize.endpoint = null;
}

function clearCircleCreateState(state: SceneStoreState): void {
  state.createCircle.center = null;
  state.createCircle.previewEdge = null;
}

function clearCircleSelection(state: SceneStoreState): void {
  state.selection.circleId = null;
}

function clearCircleResize(state: SceneStoreState): void {
  state.circleResize.active = false;
  state.circleResize.circleId = null;
  state.circleResize.mode = null;
}

function hitTestSelectedStickEndpoint(
  state: SceneStoreState,
  point: Vec2
): { movingNodeId: string; fixedNodeId: string; stickId: string } | null {
  const stickId = state.selection.stickId;
  if (!stickId) {
    return null;
  }

  const stick = state.scene.sticks[stickId];
  if (!stick) {
    return null;
  }

  const a = state.scene.nodes[stick.a];
  const b = state.scene.nodes[stick.b];
  if (!a || !b) {
    return null;
  }

  const distToA = distance(a.pos, point);
  const distToB = distance(b.pos, point);
  if (distToA > STICK_ENDPOINT_HIT_RADIUS && distToB > STICK_ENDPOINT_HIT_RADIUS) {
    return null;
  }

  if (distToA <= distToB) {
    return { movingNodeId: stick.a, fixedNodeId: stick.b, stickId: stick.id };
  }
  return { movingNodeId: stick.b, fixedNodeId: stick.a, stickId: stick.id };
}

function hitTestSelectedLineEndpoint(
  state: SceneStoreState,
  point: Vec2
): { lineId: string; endpoint: 'a' | 'b' } | null {
  const lineId = state.selection.lineId;
  if (!lineId) {
    return null;
  }

  const endpoint = hitTestLineEndpoint(state.scene, lineId, point, LINE_ENDPOINT_HIT_RADIUS);
  if (!endpoint) {
    return null;
  }
  return { lineId, endpoint };
}

function hitTestSelectedCircleHandle(
  state: SceneStoreState,
  point: Vec2
): { circleId: string; mode: 'center' | 'radius' } | null {
  const circleId = state.selection.circleId;
  if (!circleId) {
    return null;
  }

  if (hitTestCircleCenter(state.scene, circleId, point, CIRCLE_HANDLE_HIT_RADIUS)) {
    return { circleId, mode: 'center' };
  }

  if (hitTestCircleRadiusHandle(state.scene, circleId, point, CIRCLE_HANDLE_HIT_RADIUS)) {
    return { circleId, mode: 'radius' };
  }

  return null;
}

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function enforceComponentConstraints(
  scene: Scene,
  nodeIds: string[],
  stickIds: string[],
  fixedNodeIds: Set<string>,
  iterations: number
): void {
  const epsilon = 1e-6;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const stickId of stickIds) {
      const stick = scene.sticks[stickId];
      if (!stick) {
        continue;
      }
      const a = scene.nodes[stick.a];
      const b = scene.nodes[stick.b];
      if (!a || !b) {
        continue;
      }

      let dx = b.pos.x - a.pos.x;
      let dy = b.pos.y - a.pos.y;
      let currentLength = Math.hypot(dx, dy);
      if (currentLength < epsilon) {
        dx = 1;
        dy = 0;
        currentLength = 1;
      }

      const error = currentLength - stick.restLength;
      if (Math.abs(error) < epsilon) {
        continue;
      }

      const correctionX = (error * dx) / currentLength;
      const correctionY = (error * dy) / currentLength;
      const aFixed = fixedNodeIds.has(a.id);
      const bFixed = fixedNodeIds.has(b.id);

      if (!aFixed && !bFixed) {
        a.pos.x += correctionX * 0.5;
        a.pos.y += correctionY * 0.5;
        b.pos.x -= correctionX * 0.5;
        b.pos.y -= correctionY * 0.5;
      } else if (aFixed && !bFixed) {
        b.pos.x -= correctionX;
        b.pos.y -= correctionY;
      } else if (!aFixed && bFixed) {
        a.pos.x += correctionX;
        a.pos.y += correctionY;
      }
    }

    for (const nodeId of nodeIds) {
      const node = scene.nodes[nodeId];
      if (!node) {
        continue;
      }
      if (fixedNodeIds.has(nodeId)) {
        continue;
      }
      if (!node.lineConstraintId) {
        if (!node.circleConstraintId) {
          continue;
        }
      }

      if (node.lineConstraintId) {
        const line = scene.lines[node.lineConstraintId];
        if (!line) {
          node.lineConstraintId = null;
        } else {
          const projected = projectPointToInfiniteLine(node.pos, line.a, line.b);
          node.pos.x = projected.x;
          node.pos.y = projected.y;
          node.circleConstraintId = null;
          continue;
        }
      }

      if (node.circleConstraintId) {
        const circle = scene.circles[node.circleConstraintId];
        if (!circle) {
          node.circleConstraintId = null;
          continue;
        }
        const projected = projectPointToCircle(node.pos, circle.center, circle.radius);
        node.pos.x = projected.x;
        node.pos.y = projected.y;
      }
    }
  }
}

export function createSceneStore(): SceneStore {
  let nodeCounter = 0;
  let stickCounter = 0;
  let lineCounter = 0;
  let circleCounter = 0;
  let draftCreatedStartNodeId: string | null = null;
  let lastDragUpdateMs: number | null = null;
  const velocities: Record<string, Vec2> = {};

  const listeners = new Set<() => void>();

  const state: SceneStoreState = {
    scene: createEmptyScene(),
    tool: 'idle',
    drag: {
      activeNodeId: null,
      pointer: null
    },
    createStick: {
      startNodeId: null,
      previewEnd: null
    },
    createLine: {
      start: null,
      previewEnd: null
    },
    createCircle: {
      center: null,
      previewEdge: null
    },
    selection: {
      anchorNodeId: null,
      stickId: null,
      lineId: null,
      circleId: null
    },
    stickResize: {
      active: false,
      stickId: null,
      fixedNodeId: null,
      movingNodeId: null
    },
    lineResize: {
      active: false,
      lineId: null,
      endpoint: null
    },
    circleResize: {
      active: false,
      circleId: null,
      mode: null
    },
    solverOptions: {
      iterations: DEFAULT_SOLVER_OPTIONS.iterations,
      tolerancePx: DEFAULT_SOLVER_OPTIONS.tolerancePx
    },
    physics: {
      enabled: false
    }
  };

  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const nextNodeId = (): string => {
    nodeCounter += 1;
    return `node-${nodeCounter}`;
  };

  const nextStickId = (): string => {
    stickCounter += 1;
    return `stick-${stickCounter}`;
  };

  const nextLineId = (): string => {
    lineCounter += 1;
    return `line-${lineCounter}`;
  };

  const nextCircleId = (): string => {
    circleCounter += 1;
    return `circle-${circleCounter}`;
  };

  const cancelStickDraft = (): void => {
    if (draftCreatedStartNodeId) {
      removeNodeIfIsolated(state.scene, draftCreatedStartNodeId);
      draftCreatedStartNodeId = null;
    }
    clearCreateStickState(state);
  };

  const cancelLineDraft = (): void => {
    clearLineCreateState(state);
  };

  const cancelCircleDraft = (): void => {
    clearCircleCreateState(state);
  };

  const ensureVelocityNode = (nodeId: string): void => {
    if (!velocities[nodeId]) {
      velocities[nodeId] = { x: 0, y: 0 };
    }
  };

  const pruneVelocities = (): void => {
    for (const nodeId of Object.keys(velocities)) {
      if (!state.scene.nodes[nodeId]) {
        delete velocities[nodeId];
      }
    }
  };

  const resetAllVelocities = (): void => {
    pruneVelocities();
    for (const nodeId of Object.keys(state.scene.nodes)) {
      ensureVelocityNode(nodeId);
      velocities[nodeId].x = 0;
      velocities[nodeId].y = 0;
    }
  };

  const computeKineticEnergy = (): number => {
    let total = 0;
    for (const node of Object.values(state.scene.nodes)) {
      if (node.anchored) {
        continue;
      }
      ensureVelocityNode(node.id);
      const v = velocities[node.id];
      total += 0.5 * (v.x * v.x + v.y * v.y);
    }
    return total;
  };

  const isEditLocked = (): boolean => state.physics.enabled;

  const applyAnchorById = (nodeId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Anchor editing is disabled while physics is enabled.' };
    }
    const node = state.scene.nodes[nodeId];
    if (!node) {
      return { ok: false, reason: 'Node does not exist.' };
    }
    if (node.anchored) {
      return { ok: true };
    }
    node.anchored = true;
    emit();
    return { ok: true };
  };

  const applyBeginDragById = (nodeId: string): Result => {
    const node = state.scene.nodes[nodeId];
    if (!node) {
      return { ok: false, reason: 'Node does not exist.' };
    }
    if (state.physics.enabled && node.anchored) {
      return { ok: false, reason: 'Anchors are fixed while physics is enabled.' };
    }
    state.drag.activeNodeId = nodeId;
    state.drag.pointer = { x: node.pos.x, y: node.pos.y };
    lastDragUpdateMs = null;
    ensureVelocityNode(nodeId);
    emit();
    return { ok: true };
  };

  const deleteStickById = (stickId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
    }
    const stick = state.scene.sticks[stickId];
    if (!stick) {
      return { ok: false, reason: 'Stick does not exist.' };
    }

    delete state.scene.sticks[stickId];
    removeNodeIfIsolated(state.scene, stick.a);
    removeNodeIfIsolated(state.scene, stick.b);

    if (state.selection.stickId === stickId) {
      clearStickSelection(state);
    }
    if (state.stickResize.stickId === stickId) {
      clearStickResize(state);
    }

    pruneVelocities();

    emit();
    return { ok: true };
  };

  const deleteLineById = (lineId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
    }

    if (!state.scene.lines[lineId]) {
      return { ok: false, reason: 'Line does not exist.' };
    }

    delete state.scene.lines[lineId];
    for (const node of Object.values(state.scene.nodes)) {
      if (node.lineConstraintId === lineId) {
        node.lineConstraintId = null;
      }
    }

    if (state.selection.lineId === lineId) {
      clearLineSelection(state);
    }
    if (state.lineResize.lineId === lineId) {
      clearLineResize(state);
    }

    emit();
    return { ok: true };
  };

  const deleteCircleById = (circleId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
    }

    if (!state.scene.circles[circleId]) {
      return { ok: false, reason: 'Circle does not exist.' };
    }

    delete state.scene.circles[circleId];
    for (const node of Object.values(state.scene.nodes)) {
      if (node.circleConstraintId === circleId) {
        node.circleConstraintId = null;
      }
    }

    if (state.selection.circleId === circleId) {
      clearCircleSelection(state);
    }
    if (state.circleResize.circleId === circleId) {
      clearCircleResize(state);
    }

    emit();
    return { ok: true };
  };

  return {
    getState(): SceneStoreState {
      return state;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setTool(mode) {
      if (state.physics.enabled && mode !== 'idle') {
        return;
      }
      if (state.tool === mode) {
        return;
      }

      if (state.tool === 'stick') {
        cancelStickDraft();
      } else if (state.tool === 'line') {
        cancelLineDraft();
      } else if (state.tool === 'circle') {
        cancelCircleDraft();
      }

      state.tool = mode;
      state.drag.activeNodeId = null;
      state.drag.pointer = null;
      clearStickResize(state);
      clearLineResize(state);
      clearCircleResize(state);

      if (mode !== 'anchor') {
        clearAnchorSelection(state);
      }
      if (mode !== 'stick') {
        clearStickSelection(state);
      }
      if (mode !== 'line') {
        clearLineSelection(state);
        clearLineCreateState(state);
      }
      if (mode !== 'circle') {
        clearCircleSelection(state);
        clearCircleCreateState(state);
      }
      emit();
    },

    addStick(start, end): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const startSnap = snapOrCreateNode(state.scene, start, SNAP_RADIUS, nextNodeId);
      const endSnap = snapOrCreateNode(state.scene, end, SNAP_RADIUS, nextNodeId);

      const startNode = state.scene.nodes[startSnap.nodeId];
      const endNode = state.scene.nodes[endSnap.nodeId];
      const len = distance(startNode.pos, endNode.pos);

      if (startSnap.nodeId === endSnap.nodeId || len < MIN_STICK_LENGTH) {
        if (startSnap.created) {
          removeNodeIfIsolated(state.scene, startSnap.nodeId);
        }
        if (endSnap.created) {
          removeNodeIfIsolated(state.scene, endSnap.nodeId);
        }
        emit();
        return { ok: false, reason: 'Stick length too small or duplicate endpoints.' };
      }

      const stickId = nextStickId();
      state.scene.sticks[stickId] = {
        id: stickId,
        a: startSnap.nodeId,
        b: endSnap.nodeId,
        restLength: len
      };

      ensureVelocityNode(startSnap.nodeId);
      ensureVelocityNode(endSnap.nodeId);
      emit();
      return { ok: true };
    },

    setAnchor(nodeId): Result {
      return applyAnchorById(nodeId);
    },

    beginDrag(nodeId): Result {
      return applyBeginDragById(nodeId);
    },

    updateDrag(pointer): Result {
      const activeNodeId = state.drag.activeNodeId;
      if (!activeNodeId) {
        return { ok: false, reason: 'No active drag.' };
      }

      const activeNode = state.scene.nodes[activeNodeId];
      if (!activeNode) {
        return { ok: false, reason: 'Active node does not exist.' };
      }

      let constrainedPointer = { x: pointer.x, y: pointer.y };
      if (activeNode.lineConstraintId) {
        const line = state.scene.lines[activeNode.lineConstraintId];
        if (line) {
          constrainedPointer = projectPointToInfiniteLine(constrainedPointer, line.a, line.b);
          activeNode.circleConstraintId = null;
        } else {
          activeNode.lineConstraintId = null;
        }
      }

      if (!activeNode.lineConstraintId && activeNode.circleConstraintId) {
        const circle = state.scene.circles[activeNode.circleConstraintId];
        if (circle) {
          constrainedPointer = projectPointToCircle(constrainedPointer, circle.center, circle.radius);
        } else {
          activeNode.circleConstraintId = null;
        }
      }

      if (!activeNode.lineConstraintId && !activeNode.circleConstraintId) {
        const snapLineId = hitTestLine(state.scene, constrainedPointer, LINE_SNAP_RADIUS);
        const snapCircleId = hitTestCircle(state.scene, constrainedPointer, CIRCLE_SNAP_RADIUS);

        let bestKind: 'line' | 'circle' | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        if (snapLineId) {
          const line = state.scene.lines[snapLineId];
          if (line) {
            const projected = projectPointToInfiniteLine(constrainedPointer, line.a, line.b);
            const d = distance(projected, constrainedPointer);
            if (d < bestDistance) {
              bestDistance = d;
              bestKind = 'line';
            }
          }
        }

        if (snapCircleId) {
          const circle = state.scene.circles[snapCircleId];
          if (circle) {
            const d = distancePointToCircle(constrainedPointer, circle.center, circle.radius);
            if (d < bestDistance) {
              bestDistance = d;
              bestKind = 'circle';
            }
          }
        }

        if (bestKind === 'line' && snapLineId) {
          const line = state.scene.lines[snapLineId];
          if (line) {
            activeNode.lineConstraintId = snapLineId;
            activeNode.circleConstraintId = null;
            constrainedPointer = projectPointToInfiniteLine(constrainedPointer, line.a, line.b);
          }
        } else if (bestKind === 'circle' && snapCircleId) {
          const circle = state.scene.circles[snapCircleId];
          if (circle) {
            activeNode.circleConstraintId = snapCircleId;
            activeNode.lineConstraintId = null;
            constrainedPointer = projectPointToCircle(constrainedPointer, circle.center, circle.radius);
          }
        }
      }

      const previousPointer = state.drag.pointer ?? {
        x: activeNode.pos.x,
        y: activeNode.pos.y
      };
      const desiredDelta = {
        x: constrainedPointer.x - previousPointer.x,
        y: constrainedPointer.y - previousPointer.y
      };
      state.drag.pointer = { x: constrainedPointer.x, y: constrainedPointer.y };

      const component = getConnectedComponent(state.scene, activeNodeId);
      const previousPositions: Record<string, Vec2> = {};
      for (const nodeId of component.nodeIds) {
        const node = state.scene.nodes[nodeId];
        previousPositions[nodeId] = { x: node.pos.x, y: node.pos.y };
      }

      const hasOtherAnchors = component.nodeIds.some(
        (nodeId) => nodeId !== activeNodeId && state.scene.nodes[nodeId].anchored
      );

      const solverOptions = hasOtherAnchors
        ? {
            iterations: Math.max(state.solverOptions.iterations, CONSTRAINED_SOLVER_MIN_ITERATIONS),
            tolerancePx: Math.min(state.solverOptions.tolerancePx, CONSTRAINED_SOLVER_TOLERANCE_PX)
          }
        : state.solverOptions;

      let target = constrainedPointer;
      let mode: 'fixed' | 'soft' = 'fixed';

      if (hasOtherAnchors) {
        const fixedNodeIds = new Set<string>();
        for (const nodeId of component.nodeIds) {
          if (nodeId !== activeNodeId && state.scene.nodes[nodeId].anchored) {
            fixedNodeIds.add(nodeId);
          }
        }

        const projected = projectDragDeltaToConstraintSubspace(
          state.scene,
          component,
          activeNodeId,
          desiredDelta,
          fixedNodeIds
        );

        const activePos = state.scene.nodes[activeNodeId].pos;
        const dragDisp = projected[activeNodeId] ?? { x: 0, y: 0 };
        target = {
          x: activePos.x + dragDisp.x,
          y: activePos.y + dragDisp.y
        };
        mode = 'soft';
      }

      const solved = solveComponentPositions(
        state.scene,
        component,
        activeNodeId,
        target,
        solverOptions,
        mode
      );

      for (const nodeId of component.nodeIds) {
        const solvedPos = solved.positions[nodeId];
        if (!solvedPos) {
          continue;
        }
        state.scene.nodes[nodeId].pos.x = solvedPos.x;
        state.scene.nodes[nodeId].pos.y = solvedPos.y;
      }
      const refinementFixedNodeIds = new Set<string>();
      for (const nodeId of component.nodeIds) {
        if (nodeId !== activeNodeId && state.scene.nodes[nodeId].anchored) {
          refinementFixedNodeIds.add(nodeId);
        }
      }
      if (mode === 'fixed') {
        refinementFixedNodeIds.add(activeNodeId);
      }
      enforceComponentConstraints(
        state.scene,
        component.nodeIds,
        component.stickIds,
        refinementFixedNodeIds,
        hasOtherAnchors ? 60 : 24
      );

      if (state.physics.enabled) {
        const nowMs = getNowMs();
        const dtSeconds =
          lastDragUpdateMs === null
            ? 1 / 60
            : Math.max((nowMs - lastDragUpdateMs) / 1000, DRAG_VELOCITY_MIN_DT_SECONDS);
        lastDragUpdateMs = nowMs;

        for (const nodeId of component.nodeIds) {
          ensureVelocityNode(nodeId);
          const node = state.scene.nodes[nodeId];
          if (node.anchored) {
            velocities[nodeId].x = 0;
            velocities[nodeId].y = 0;
            continue;
          }

          const previous = previousPositions[nodeId];
          velocities[nodeId].x = (node.pos.x - previous.x) / dtSeconds;
          velocities[nodeId].y = (node.pos.y - previous.y) / dtSeconds;
        }
      }

      emit();
      return { ok: true };
    },

    endDrag(): Result {
      if (!state.drag.activeNodeId) {
        return { ok: false, reason: 'No active drag.' };
      }
      state.drag.activeNodeId = null;
      state.drag.pointer = null;
      lastDragUpdateMs = null;
      emit();
      return { ok: true };
    },

    beginStick(start): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const startSnap = snapOrCreateNode(state.scene, start, SNAP_RADIUS, nextNodeId);
      state.createStick.startNodeId = startSnap.nodeId;
      state.createStick.previewEnd = { x: start.x, y: start.y };
      draftCreatedStartNodeId = startSnap.created ? startSnap.nodeId : null;
      ensureVelocityNode(startSnap.nodeId);
      emit();
      return { ok: true };
    },

    updateStickPreview(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      if (!state.createStick.startNodeId) {
        return { ok: false, reason: 'No active stick creation.' };
      }
      state.createStick.previewEnd = { x: pointer.x, y: pointer.y };
      emit();
      return { ok: true };
    },

    endStick(end): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const startNodeId = state.createStick.startNodeId;
      if (!startNodeId) {
        return { ok: false, reason: 'No active stick creation.' };
      }

      const endSnap = snapOrCreateNode(state.scene, end, SNAP_RADIUS, nextNodeId);
      const startNode = state.scene.nodes[startNodeId];
      const endNode = state.scene.nodes[endSnap.nodeId];

      const len = distance(startNode.pos, endNode.pos);

      if (startNodeId === endSnap.nodeId || len < MIN_STICK_LENGTH) {
        if (endSnap.created) {
          removeNodeIfIsolated(state.scene, endSnap.nodeId);
        }
        if (draftCreatedStartNodeId) {
          removeNodeIfIsolated(state.scene, draftCreatedStartNodeId);
          draftCreatedStartNodeId = null;
        }
        clearCreateStickState(state);
        emit();
        return { ok: false, reason: 'Stick length too small or duplicate endpoints.' };
      }

      const stickId = nextStickId();
      state.scene.sticks[stickId] = {
        id: stickId,
        a: startNodeId,
        b: endSnap.nodeId,
        restLength: len
      };

      ensureVelocityNode(startNodeId);
      ensureVelocityNode(endSnap.nodeId);
      draftCreatedStartNodeId = null;
      clearCreateStickState(state);
      emit();
      return { ok: true };
    },

    clearSelectionForTool(): void {
      if (state.tool === 'anchor') {
        if (state.selection.anchorNodeId) {
          clearAnchorSelection(state);
          emit();
        }
        return;
      }
      if (state.tool === 'stick') {
        const hadSelection = state.selection.stickId || state.stickResize.active;
        clearStickSelection(state);
        clearStickResize(state);
        if (hadSelection) {
          emit();
        }
        return;
      }
      if (state.tool === 'line') {
        const hadSelection = state.selection.lineId || state.lineResize.active || state.createLine.start;
        clearLineSelection(state);
        clearLineResize(state);
        clearLineCreateState(state);
        if (hadSelection) {
          emit();
        }
        return;
      }
      if (state.tool === 'circle') {
        const hadSelection =
          state.selection.circleId || state.circleResize.active || state.createCircle.center;
        clearCircleSelection(state);
        clearCircleResize(state);
        clearCircleCreateState(state);
        if (hadSelection) {
          emit();
        }
      }
    },

    tryHandleAnchorToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Anchor editing is disabled while physics is enabled.' };
      }
      const nodeId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (!nodeId) {
        if (state.selection.anchorNodeId) {
          clearAnchorSelection(state);
          emit();
        }
        return { ok: false, reason: 'No pivot near click.' };
      }

      const node = state.scene.nodes[nodeId];
      if (!node.anchored) {
        clearAnchorSelection(state);
        return applyAnchorById(nodeId);
      }

      state.selection.anchorNodeId = nodeId;
      emit();
      return { ok: true };
    },

    tryHandleStickToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const hitStickId = hitTestStick(state.scene, point, STICK_HIT_RADIUS);
      if (hitStickId) {
        state.selection.stickId = hitStickId;
        clearStickResize(state);
        emit();
        return { ok: true };
      }

      if (state.selection.stickId || state.stickResize.active) {
        clearStickSelection(state);
        clearStickResize(state);
        emit();
      }
      return { ok: false, reason: 'No stick near click.' };
    },

    tryBeginSelectedStickResizeAt(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const endpoint = hitTestSelectedStickEndpoint(state, point);
      if (!endpoint) {
        return { ok: false, reason: 'No selected stick endpoint near click.' };
      }

      state.stickResize.active = true;
      state.stickResize.stickId = endpoint.stickId;
      state.stickResize.fixedNodeId = endpoint.fixedNodeId;
      state.stickResize.movingNodeId = endpoint.movingNodeId;
      emit();
      return { ok: true };
    },

    updateSelectedStickResize(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      if (!state.stickResize.active || !state.stickResize.stickId) {
        return { ok: false, reason: 'No active stick resize.' };
      }

      const stick = state.scene.sticks[state.stickResize.stickId];
      const fixedNode = state.stickResize.fixedNodeId
        ? state.scene.nodes[state.stickResize.fixedNodeId]
        : null;
      const movingNode = state.stickResize.movingNodeId
        ? state.scene.nodes[state.stickResize.movingNodeId]
        : null;

      if (!stick || !fixedNode || !movingNode) {
        return { ok: false, reason: 'Stick resize state is invalid.' };
      }

      movingNode.pos.x = pointer.x;
      movingNode.pos.y = pointer.y;
      if (movingNode.lineConstraintId) {
        const line = state.scene.lines[movingNode.lineConstraintId];
        if (line) {
          const projected = projectPointToInfiniteLine(movingNode.pos, line.a, line.b);
          movingNode.pos.x = projected.x;
          movingNode.pos.y = projected.y;
          movingNode.circleConstraintId = null;
        } else {
          movingNode.lineConstraintId = null;
        }
      }
      if (!movingNode.lineConstraintId && movingNode.circleConstraintId) {
        const circle = state.scene.circles[movingNode.circleConstraintId];
        if (circle) {
          const projected = projectPointToCircle(movingNode.pos, circle.center, circle.radius);
          movingNode.pos.x = projected.x;
          movingNode.pos.y = projected.y;
        } else {
          movingNode.circleConstraintId = null;
        }
      }
      stick.restLength = distance(fixedNode.pos, movingNode.pos);
      ensureVelocityNode(movingNode.id);
      velocities[movingNode.id].x = 0;
      velocities[movingNode.id].y = 0;
      emit();
      return { ok: true };
    },

    endSelectedStickResize(): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      if (!state.stickResize.active) {
        return { ok: false, reason: 'No active stick resize.' };
      }

      clearStickResize(state);
      emit();
      return { ok: true };
    },

    beginLine(start): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      state.createLine.start = { x: start.x, y: start.y };
      state.createLine.previewEnd = { x: start.x, y: start.y };
      clearLineSelection(state);
      clearLineResize(state);
      emit();
      return { ok: true };
    },

    updateLinePreview(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      if (!state.createLine.start) {
        return { ok: false, reason: 'No active line creation.' };
      }
      state.createLine.previewEnd = { x: pointer.x, y: pointer.y };
      emit();
      return { ok: true };
    },

    endLine(end): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      const start = state.createLine.start;
      if (!start) {
        return { ok: false, reason: 'No active line creation.' };
      }

      const lineLength = distance(start, end);
      if (lineLength < MIN_LINE_LENGTH) {
        clearLineCreateState(state);
        emit();
        return { ok: false, reason: 'Line length too small.' };
      }

      const lineId = nextLineId();
      state.scene.lines[lineId] = {
        id: lineId,
        a: { x: start.x, y: start.y },
        b: { x: end.x, y: end.y }
      };
      state.selection.lineId = lineId;
      clearLineCreateState(state);
      emit();
      return { ok: true };
    },

    tryHandleLineToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      const lineId = hitTestLine(state.scene, point, LINE_HIT_RADIUS);
      if (!lineId) {
        if (state.selection.lineId || state.lineResize.active) {
          clearLineSelection(state);
          clearLineResize(state);
          emit();
        }
        return { ok: false, reason: 'No line near click.' };
      }

      state.selection.lineId = lineId;
      clearLineResize(state);
      clearLineCreateState(state);
      emit();
      return { ok: true };
    },

    tryBeginSelectedLineResizeAt(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }

      const endpoint = hitTestSelectedLineEndpoint(state, point);
      if (!endpoint) {
        return { ok: false, reason: 'No selected line endpoint near click.' };
      }

      state.lineResize.active = true;
      state.lineResize.lineId = endpoint.lineId;
      state.lineResize.endpoint = endpoint.endpoint;
      emit();
      return { ok: true };
    },

    updateSelectedLineResize(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      if (!state.lineResize.active || !state.lineResize.lineId || !state.lineResize.endpoint) {
        return { ok: false, reason: 'No active line resize.' };
      }

      const line = state.scene.lines[state.lineResize.lineId];
      if (!line) {
        return { ok: false, reason: 'Selected line no longer exists.' };
      }

      if (state.lineResize.endpoint === 'a') {
        line.a = { x: pointer.x, y: pointer.y };
      } else {
        line.b = { x: pointer.x, y: pointer.y };
      }
      const nodeIds = Object.keys(state.scene.nodes);
      enforceComponentConstraints(state.scene, nodeIds, [], new Set<string>(), 1);
      emit();
      return { ok: true };
    },

    endSelectedLineResize(): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Line editing is disabled while physics is enabled.' };
      }
      if (!state.lineResize.active) {
        return { ok: false, reason: 'No active line resize.' };
      }
      clearLineResize(state);
      emit();
      return { ok: true };
    },

    deleteSelectedLine(): Result {
      const lineId = state.selection.lineId;
      if (!lineId) {
        return { ok: false, reason: 'No selected line.' };
      }
      return deleteLineById(lineId);
    },

    beginCircle(center): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      state.createCircle.center = { x: center.x, y: center.y };
      state.createCircle.previewEdge = { x: center.x, y: center.y };
      clearCircleSelection(state);
      clearCircleResize(state);
      emit();
      return { ok: true };
    },

    updateCirclePreview(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      if (!state.createCircle.center) {
        return { ok: false, reason: 'No active circle creation.' };
      }
      state.createCircle.previewEdge = { x: pointer.x, y: pointer.y };
      emit();
      return { ok: true };
    },

    endCircle(edgePoint): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      const center = state.createCircle.center;
      if (!center) {
        return { ok: false, reason: 'No active circle creation.' };
      }

      const radius = distance(center, edgePoint);
      if (radius < MIN_CIRCLE_RADIUS) {
        clearCircleCreateState(state);
        emit();
        return { ok: false, reason: 'Circle radius too small.' };
      }

      const circleId = nextCircleId();
      state.scene.circles[circleId] = {
        id: circleId,
        center: { x: center.x, y: center.y },
        radius
      };
      state.selection.circleId = circleId;
      clearCircleCreateState(state);
      emit();
      return { ok: true };
    },

    tryHandleCircleToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      const circleId = hitTestCircle(state.scene, point, CIRCLE_HIT_RADIUS);
      if (!circleId) {
        if (state.selection.circleId || state.circleResize.active) {
          clearCircleSelection(state);
          clearCircleResize(state);
          emit();
        }
        return { ok: false, reason: 'No circle near click.' };
      }

      state.selection.circleId = circleId;
      clearCircleResize(state);
      clearCircleCreateState(state);
      emit();
      return { ok: true };
    },

    tryBeginSelectedCircleResizeAt(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }

      const handle = hitTestSelectedCircleHandle(state, point);
      if (!handle) {
        return { ok: false, reason: 'No selected circle handle near click.' };
      }

      state.circleResize.active = true;
      state.circleResize.circleId = handle.circleId;
      state.circleResize.mode = handle.mode;
      emit();
      return { ok: true };
    },

    updateSelectedCircleResize(pointer): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      if (!state.circleResize.active || !state.circleResize.circleId || !state.circleResize.mode) {
        return { ok: false, reason: 'No active circle resize.' };
      }

      const circle = state.scene.circles[state.circleResize.circleId];
      if (!circle) {
        return { ok: false, reason: 'Selected circle no longer exists.' };
      }

      if (state.circleResize.mode === 'center') {
        circle.center = { x: pointer.x, y: pointer.y };
      } else {
        const radius = distance(circle.center, pointer);
        circle.radius = Math.max(radius, MIN_CIRCLE_RADIUS);
      }

      const nodeIds = Object.keys(state.scene.nodes);
      const stickIds = Object.keys(state.scene.sticks);
      const fixedNodeIds = new Set<string>(nodeIds.filter((nodeId) => state.scene.nodes[nodeId].anchored));
      enforceComponentConstraints(state.scene, nodeIds, stickIds, fixedNodeIds, 8);
      emit();
      return { ok: true };
    },

    endSelectedCircleResize(): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Circle editing is disabled while physics is enabled.' };
      }
      if (!state.circleResize.active) {
        return { ok: false, reason: 'No active circle resize.' };
      }
      clearCircleResize(state);
      emit();
      return { ok: true };
    },

    deleteSelectedCircle(): Result {
      const circleId = state.selection.circleId;
      if (!circleId) {
        return { ok: false, reason: 'No selected circle.' };
      }
      return deleteCircleById(circleId);
    },

    deleteSelectedAnchor(): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Anchor editing is disabled while physics is enabled.' };
      }
      const selectedId = state.selection.anchorNodeId;
      if (!selectedId) {
        return { ok: false, reason: 'No selected anchor.' };
      }

      const node = state.scene.nodes[selectedId];
      if (!node) {
        clearAnchorSelection(state);
        emit();
        return { ok: false, reason: 'Selected anchor no longer exists.' };
      }

      node.anchored = false;
      clearAnchorSelection(state);
      emit();
      return { ok: true };
    },

    deleteSelectedStick(): Result {
      const selectedStickId = state.selection.stickId;
      if (!selectedStickId) {
        return { ok: false, reason: 'No selected stick.' };
      }
      return deleteStickById(selectedStickId);
    },

    setPhysicsEnabled(enabled: boolean): void {
      if (state.physics.enabled === enabled) {
        return;
      }

      if (enabled) {
        if (state.tool === 'stick') {
          cancelStickDraft();
        } else if (state.tool === 'line') {
          cancelLineDraft();
        } else if (state.tool === 'circle') {
          cancelCircleDraft();
        }
        clearAnchorSelection(state);
        clearStickSelection(state);
        clearLineSelection(state);
        clearCircleSelection(state);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        state.tool = 'idle';
        state.drag.activeNodeId = null;
        state.drag.pointer = null;
        lastDragUpdateMs = null;
        pruneVelocities();
        // Enter physics from a zero-momentum state while still satisfying rigid constraints.
        const nodeIds = Object.keys(state.scene.nodes);
        const stickIds = Object.keys(state.scene.sticks);
        const fixedNodeIds = new Set<string>(
          nodeIds.filter((nodeId) => state.scene.nodes[nodeId].anchored)
        );
        enforceComponentConstraints(
          state.scene,
          nodeIds,
          stickIds,
          fixedNodeIds,
          PHYSICS_CONSTRAINT_ITERATIONS * 2
        );
      } else {
        state.drag.activeNodeId = null;
        state.drag.pointer = null;
        lastDragUpdateMs = null;
      }

      state.physics.enabled = enabled;
      resetAllVelocities();
      emit();
    },

    stepPhysics(dtSeconds): Result {
      if (!state.physics.enabled) {
        return { ok: false, reason: 'Physics is disabled.' };
      }
      if (state.drag.activeNodeId) {
        return { ok: false, reason: 'Physics pauses during manual drag.' };
      }
      if (!(dtSeconds > 0)) {
        return { ok: false, reason: 'Invalid timestep.' };
      }

      pruneVelocities();
      for (const nodeId of Object.keys(state.scene.nodes)) {
        ensureVelocityNode(nodeId);
      }

      let remaining = Math.min(dtSeconds, 0.05);
      while (remaining > 0) {
        const stepDt = Math.min(remaining, PHYSICS_MAX_STEP_SECONDS);
        remaining -= stepDt;

        const nodeIds = Object.keys(state.scene.nodes);
        const stickIds = Object.keys(state.scene.sticks);
        const fixedNodeIds = new Set<string>(
          nodeIds.filter((nodeId) => state.scene.nodes[nodeId].anchored)
        );

        const previousPositions: Record<string, Vec2> = {};
        for (const nodeId of nodeIds) {
          const node = state.scene.nodes[nodeId];
          previousPositions[node.id] = { x: node.pos.x, y: node.pos.y };
        }

        for (const nodeId of nodeIds) {
          const node = state.scene.nodes[nodeId];
          if (fixedNodeIds.has(nodeId)) {
            velocities[node.id].x = 0;
            velocities[node.id].y = 0;
            continue;
          }
          node.pos.x += velocities[node.id].x * stepDt;
          node.pos.y += velocities[node.id].y * stepDt;
        }

        const energyBeforeProjection = computeKineticEnergy();
        enforceComponentConstraints(
          state.scene,
          nodeIds,
          stickIds,
          fixedNodeIds,
          PHYSICS_CONSTRAINT_ITERATIONS
        );

        for (const nodeId of nodeIds) {
          const node = state.scene.nodes[nodeId];
          if (fixedNodeIds.has(nodeId)) {
            velocities[node.id].x = 0;
            velocities[node.id].y = 0;
            continue;
          }

          const previous = previousPositions[node.id];
          velocities[node.id].x = (node.pos.x - previous.x) / stepDt;
          velocities[node.id].y = (node.pos.y - previous.y) / stepDt;
        }

        const energyAfterProjection = computeKineticEnergy();
        if (energyBeforeProjection <= PHYSICS_ENERGY_EPSILON) {
          for (const node of Object.values(state.scene.nodes)) {
            if (node.anchored) {
              continue;
            }
            velocities[node.id].x = 0;
            velocities[node.id].y = 0;
          }
        } else if (energyAfterProjection > PHYSICS_ENERGY_EPSILON) {
          const scale = Math.sqrt(energyBeforeProjection / energyAfterProjection);
          for (const node of Object.values(state.scene.nodes)) {
            if (node.anchored) {
              continue;
            }
            velocities[node.id].x *= scale;
            velocities[node.id].y *= scale;
          }
        }
      }

      emit();
      return { ok: true };
    },

    tryAnchorAt(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Anchor editing is disabled while physics is enabled.' };
      }
      const nodeId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (!nodeId) {
        return { ok: false, reason: 'No pivot near click.' };
      }
      return applyAnchorById(nodeId);
    },

    tryBeginDragAt(point): Result {
      if (state.tool !== 'idle') {
        return { ok: false, reason: 'Drag can only begin in idle mode.' };
      }
      const nodeId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (!nodeId) {
        return { ok: false, reason: 'No pivot near click.' };
      }
      return applyBeginDragById(nodeId);
    }
  };
}
