import {
  DEFAULT_CIRCLE_HANDLE_HIT_RADIUS,
  DEFAULT_CIRCLE_HIT_RADIUS,
  DEFAULT_LINE_ENDPOINT_HIT_RADIUS,
  DEFAULT_LINE_HIT_RADIUS,
  DEFAULT_PIVOT_HIT_RADIUS,
  DEFAULT_SNAP_RADIUS,
  DEFAULT_STICK_HIT_RADIUS,
  distance,
  hitTestLine,
  hitTestCircle,
  hitTestCircleCenter,
  hitTestCircleRadiusHandle,
  hitTestLineEndpoint,
  hitTestPivot,
  hitTestStick,
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
export const DEFAULT_PEN_COLOR = '#7b3fe4';
export const PEN_HIT_RADIUS = DEFAULT_PIVOT_HIT_RADIUS;
const CONSTRAINED_SOLVER_MIN_ITERATIONS = 500;
const CONSTRAINED_SOLVER_TOLERANCE_PX = 0.005;
const PHYSICS_CONSTRAINT_ITERATIONS = 30;
const PHYSICS_MAX_STEP_SECONDS = 1 / 120;
const DRAG_VELOCITY_MIN_DT_SECONDS = 1 / 240;
const PHYSICS_ENERGY_EPSILON = 1e-9;
const CONSTRAINT_RELEASE_DISTANCE = 16;
const CONSTRAINT_RELEASE_DIRECTION_RATIO = 1.25;
const CONSTRAINT_RELEASE_MIN_STEP = 1.5;

export type SnapResult = {
  nodeId: string;
  created: boolean;
};

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

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

function clearPivotSelection(state: SceneStoreState): void {
  state.selection.pivotNodeId = null;
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

function clearAllSelections(state: SceneStoreState): void {
  clearAnchorSelection(state);
  clearPivotSelection(state);
  clearStickSelection(state);
  clearLineSelection(state);
  clearCircleSelection(state);
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

function projectPointToSegment(point: Vec2, a: Vec2, b: Vec2): { projected: Vec2; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) {
    return { projected: { x: a.x, y: a.y }, t: 0 };
  }
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const rawT = (wx * vx + wy * vy) / lenSq;
  const t = Math.min(1, Math.max(0, rawT));
  return {
    projected: {
      x: a.x + t * vx,
      y: a.y + t * vy
    },
    t
  };
}

function findInteriorStickHit(
  scene: Scene,
  point: Vec2,
  radius: number,
  excludedStickIds: Set<string> = new Set<string>()
): { stickId: string; projected: Vec2 } | null {
  let best: { stickId: string; projected: Vec2 } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const stick of Object.values(scene.sticks)) {
    if (stick.visible === false) {
      continue;
    }
    if (excludedStickIds.has(stick.id)) {
      continue;
    }
    const a = scene.nodes[stick.a]?.pos;
    const b = scene.nodes[stick.b]?.pos;
    if (!a || !b) {
      continue;
    }

    const { projected } = projectPointToSegment(point, a, b);
    const distToA = distance(projected, a);
    const distToB = distance(projected, b);
    if (distToA <= STICK_ENDPOINT_HIT_RADIUS || distToB <= STICK_ENDPOINT_HIT_RADIUS) {
      continue;
    }

    const d = distance(point, projected);
    if (d > radius) {
      continue;
    }
    if (d < bestDistance) {
      bestDistance = d;
      best = { stickId: stick.id, projected };
    }
  }

  return best;
}

function setAnchorSelection(state: SceneStoreState, nodeId: string): void {
  clearAllSelections(state);
  state.selection.anchorNodeId = nodeId;
}

function setPivotSelection(state: SceneStoreState, nodeId: string): void {
  clearAllSelections(state);
  state.selection.pivotNodeId = nodeId;
}

function setStickSelection(state: SceneStoreState, stickId: string): void {
  clearAllSelections(state);
  state.selection.stickId = stickId;
}

function setLineSelection(state: SceneStoreState, lineId: string): void {
  clearAllSelections(state);
  state.selection.lineId = lineId;
}

function setCircleSelection(state: SceneStoreState, circleId: string): void {
  clearAllSelections(state);
  state.selection.circleId = circleId;
}

function getNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function normalize(v: Vec2): Vec2 | null {
  const len = Math.hypot(v.x, v.y);
  if (len <= 1e-9) {
    return null;
  }
  return { x: v.x / len, y: v.y / len };
}

function shouldReleaseFromLine(line: { a: Vec2; b: Vec2 }, previousRaw: Vec2, raw: Vec2): boolean {
  const tangent = normalize({ x: line.b.x - line.a.x, y: line.b.y - line.a.y });
  if (!tangent) {
    return false;
  }

  const normal = { x: -tangent.y, y: tangent.x };
  const rawDelta = { x: raw.x - previousRaw.x, y: raw.y - previousRaw.y };
  const projected = projectPointToInfiniteLine(raw, line.a, line.b);
  const offset = distance(raw, projected);
  const normalStep = Math.abs(dot(rawDelta, normal));
  const tangentStep = Math.abs(dot(rawDelta, tangent));

  return (
    offset >= CONSTRAINT_RELEASE_DISTANCE &&
    normalStep >= CONSTRAINT_RELEASE_MIN_STEP &&
    normalStep >= tangentStep * CONSTRAINT_RELEASE_DIRECTION_RATIO
  );
}

function getAttachmentHingeNodeId(scene: Scene, attachmentStickId: string): string | null {
  const attachment = scene.sticks[attachmentStickId];
  if (!attachment || attachment.visible !== false || !attachment.attachmentHostStickId) {
    return null;
  }

  const host = scene.sticks[attachment.attachmentHostStickId];
  if (!host) {
    return null;
  }

  if (attachment.a === host.a || attachment.a === host.b) {
    return attachment.b;
  }
  if (attachment.b === host.a || attachment.b === host.b) {
    return attachment.a;
  }
  return null;
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
        node.circleConstraintId = null;
        continue;
      }

      const line = scene.lines[node.lineConstraintId];
      if (!line) {
        node.lineConstraintId = null;
        node.circleConstraintId = null;
        continue;
      }

      const projected = projectPointToInfiniteLine(node.pos, line.a, line.b);
      node.pos.x = projected.x;
      node.pos.y = projected.y;
      node.circleConstraintId = null;
    }

    // Keep interior attachments centered on the host stick centerline.
    const projectedPairs = new Set<string>();
    for (const stickId of stickIds) {
      const attachment = scene.sticks[stickId];
      if (!attachment || attachment.visible !== false || !attachment.attachmentHostStickId) {
        continue;
      }

      const host = scene.sticks[attachment.attachmentHostStickId];
      if (!host) {
        continue;
      }

      const hingeNodeId = getAttachmentHingeNodeId(scene, stickId);
      if (!hingeNodeId) {
        continue;
      }
      if (fixedNodeIds.has(hingeNodeId)) {
        continue;
      }

      const key = `${host.id}:${hingeNodeId}`;
      if (projectedPairs.has(key)) {
        continue;
      }
      projectedPairs.add(key);

      const hostA = scene.nodes[host.a]?.pos;
      const hostB = scene.nodes[host.b]?.pos;
      const hinge = scene.nodes[hingeNodeId];
      if (!hostA || !hostB || !hinge) {
        continue;
      }

      const { projected } = projectPointToSegment(hinge.pos, hostA, hostB);
      hinge.pos.x = projected.x;
      hinge.pos.y = projected.y;
    }
  }
}

export function createSceneStore(): SceneStore {
  let nodeCounter = 0;
  let stickCounter = 0;
  let lineCounter = 0;
  let circleCounter = 0;
  let draftCreatedStartNodeId: string | null = null;
  let draftStartInteriorTarget = false;
  let lastDragUpdateMs: number | null = null;
  const velocities: Record<string, Vec2> = {};

  const listeners = new Set<() => void>();

  const state: SceneStoreState = {
    scene: createEmptyScene(),
    pens: {},
    penTrails: {},
    tool: 'idle',
    drag: {
      activeNodeId: null,
      pointer: null,
      rawPointer: null
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
      pivotNodeId: null,
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
    draftStartInteriorTarget = false;
    clearCreateStickState(state);
  };

  const cancelLineDraft = (): void => {
    clearLineCreateState(state);
  };

  const cancelCircleDraft = (): void => {
    clearCircleCreateState(state);
  };

  const createNodeAt = (point: Vec2): string => {
    const nodeId = nextNodeId();
    state.scene.nodes[nodeId] = {
      id: nodeId,
      pos: { x: point.x, y: point.y },
      anchored: false,
      lineConstraintId: null,
      circleConstraintId: null
    };
    ensureVelocityNode(nodeId);
    return nodeId;
  };

  const bindNodeToNearbyLine = (nodeId: string): void => {
    const node = state.scene.nodes[nodeId];
    if (!node) {
      return;
    }
    const lineId = hitTestLine(state.scene, node.pos, LINE_SNAP_RADIUS);
    if (!lineId) {
      return;
    }
    const line = state.scene.lines[lineId];
    if (!line) {
      return;
    }
    const projected = projectPointToInfiniteLine(node.pos, line.a, line.b);
    node.pos.x = projected.x;
    node.pos.y = projected.y;
    node.lineConstraintId = lineId;
    node.circleConstraintId = null;
  };

  const findExistingAttachmentStickBetween = (
    aId: string,
    bId: string,
    hostStickId: string
  ): string | null => {
    for (const stick of Object.values(state.scene.sticks)) {
      if (stick.visible !== false) {
        continue;
      }
      if (stick.attachmentHostStickId !== hostStickId) {
        continue;
      }
      if (
        (stick.a === aId && stick.b === bId) ||
        (stick.a === bId && stick.b === aId)
      ) {
        return stick.id;
      }
    }
    return null;
  };

  const upsertAttachmentStickBetween = (
    aId: string,
    bId: string,
    restLength: number,
    hostStickId: string
  ): boolean => {
    if (restLength < MIN_STICK_LENGTH) {
      return false;
    }
    const existingId = findExistingAttachmentStickBetween(aId, bId, hostStickId);
    if (existingId) {
      state.scene.sticks[existingId].restLength = restLength;
      return true;
    }

    const stickId = nextStickId();
    state.scene.sticks[stickId] = {
      id: stickId,
      a: aId,
      b: bId,
      restLength,
      visible: false,
      attachmentHostStickId: hostStickId
    };
    ensureVelocityNode(aId);
    ensureVelocityNode(bId);
    return true;
  };

  const attachNodeRigidToStick = (stickId: string, hingeNodeId: string): boolean => {
    const target = state.scene.sticks[stickId];
    const hinge = state.scene.nodes[hingeNodeId];
    if (!target || !hinge) {
      return false;
    }
    if (target.a === hingeNodeId || target.b === hingeNodeId) {
      return false;
    }

    const a = state.scene.nodes[target.a];
    const b = state.scene.nodes[target.b];
    if (!a || !b) {
      return false;
    }

    const lenA = distance(a.pos, hinge.pos);
    const lenB = distance(hinge.pos, b.pos);
    if (lenA < MIN_STICK_LENGTH || lenB < MIN_STICK_LENGTH) {
      return false;
    }

    const aLinked = upsertAttachmentStickBetween(target.a, hingeNodeId, lenA, stickId);
    const bLinked = upsertAttachmentStickBetween(hingeNodeId, target.b, lenB, stickId);
    return aLinked && bLinked;
  };

  const ensureVelocityNode = (nodeId: string): void => {
    if (!velocities[nodeId]) {
      velocities[nodeId] = { x: 0, y: 0 };
    }
  };

  const removePenForNode = (nodeId: string): void => {
    if (state.selection.pivotNodeId === nodeId && state.scene.nodes[nodeId]?.anchored) {
      clearPivotSelection(state);
    }
    delete state.pens[nodeId];
    delete state.penTrails[nodeId];
  };

  const prunePens = (): void => {
    for (const nodeId of Object.keys(state.pens)) {
      const node = state.scene.nodes[nodeId];
      if (!node || node.anchored) {
        removePenForNode(nodeId);
      }
    }
    for (const nodeId of Object.keys(state.penTrails)) {
      if (!state.scene.nodes[nodeId] || !state.pens[nodeId]) {
        delete state.penTrails[nodeId];
      }
    }
  };

  const clearPenTrails = (): void => {
    state.penTrails = {};
  };

  const appendPenTrailPoint = (nodeId: string, point: Vec2, color: string): void => {
    const normalizedColor = isHexColor(color) ? color.toLowerCase() : DEFAULT_PEN_COLOR;
    let strokes = state.penTrails[nodeId];
    if (!strokes) {
      strokes = [];
      state.penTrails[nodeId] = strokes;
    }

    let stroke = strokes[strokes.length - 1];
    if (!stroke || stroke.color.toLowerCase() !== normalizedColor) {
      stroke = { color: normalizedColor, points: [] };
      strokes.push(stroke);
    }

    const lastPoint = stroke.points[stroke.points.length - 1];
    if (!lastPoint || distance(lastPoint, point) > 0.25) {
      stroke.points.push({ x: point.x, y: point.y });
    }
  };

  const recordPenTrails = (): void => {
    if (!state.physics.enabled) {
      return;
    }
    for (const pen of Object.values(state.pens)) {
      if (!pen.enabled) {
        continue;
      }
      const node = state.scene.nodes[pen.nodeId];
      if (!node || node.anchored) {
        continue;
      }
      appendPenTrailPoint(pen.nodeId, node.pos, pen.color);
    }
  };

  const beginPenTrailSession = (): void => {
    clearPenTrails();
    recordPenTrails();
  };

  const pruneVelocities = (): void => {
    for (const nodeId of Object.keys(velocities)) {
      if (!state.scene.nodes[nodeId]) {
        delete velocities[nodeId];
      }
    }
    prunePens();
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
      removePenForNode(nodeId);
      setAnchorSelection(state, nodeId);
      clearStickResize(state);
      clearLineResize(state);
      clearCircleResize(state);
      emit();
      return { ok: true };
    }
    node.anchored = true;
    removePenForNode(nodeId);
    setAnchorSelection(state, nodeId);
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
    state.drag.rawPointer = { x: node.pos.x, y: node.pos.y };
    lastDragUpdateMs = null;
    ensureVelocityNode(nodeId);
    emit();
    return { ok: true };
  };

  const hitTestPenAtPoint = (point: Vec2, radius = PEN_HIT_RADIUS): string | null => {
    const limitSq = radius * radius;
    let bestNodeId: string | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (const pen of Object.values(state.pens)) {
      const node = state.scene.nodes[pen.nodeId];
      if (!node || node.anchored) {
        continue;
      }
      const dx = node.pos.x - point.x;
      const dy = node.pos.y - point.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > limitSq) {
        continue;
      }
      if (d2 < bestDistanceSq) {
        bestDistanceSq = d2;
        bestNodeId = node.id;
      }
    }

    return bestNodeId;
  };

  const applySetPenByNodeId = (nodeId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Pen editing is disabled while physics is enabled.' };
    }
    const node = state.scene.nodes[nodeId];
    if (!node) {
      return { ok: false, reason: 'Node does not exist.' };
    }
    if (node.anchored) {
      return { ok: false, reason: 'Cannot assign a pen to an anchor.' };
    }

    const existing = state.pens[nodeId];
    const color = existing && isHexColor(existing.color) ? existing.color.toLowerCase() : DEFAULT_PEN_COLOR;
    state.pens[nodeId] = {
      nodeId,
      color,
      enabled: existing?.enabled ?? true
    };
    setPivotSelection(state, nodeId);
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

    const dependentAttachments = Object.values(state.scene.sticks)
      .filter(
        (candidate) => candidate.visible === false && candidate.attachmentHostStickId === stickId
      );

    delete state.scene.sticks[stickId];
    for (const attachment of dependentAttachments) {
      delete state.scene.sticks[attachment.id];
    }

    removeNodeIfIsolated(state.scene, stick.a);
    removeNodeIfIsolated(state.scene, stick.b);
    for (const attachment of dependentAttachments) {
      removeNodeIfIsolated(state.scene, attachment.a);
      removeNodeIfIsolated(state.scene, attachment.b);
    }

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

  const deletePivotById = (nodeId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Pivot editing is disabled while physics is enabled.' };
    }

    const node = state.scene.nodes[nodeId];
    if (!node) {
      return { ok: false, reason: 'Pivot does not exist.' };
    }
    if (node.anchored) {
      return { ok: false, reason: 'Anchors are deleted via anchor delete.' };
    }

    const incidentStickIds = Object.values(state.scene.sticks)
      .filter((stick) => stick.a === nodeId || stick.b === nodeId)
      .map((stick) => stick.id);

    for (const stickId of incidentStickIds) {
      const stick = state.scene.sticks[stickId];
      if (!stick) {
        continue;
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
    }

    delete state.scene.nodes[nodeId];
    clearPivotSelection(state);
    pruneVelocities();
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
      state.drag.rawPointer = null;
      clearStickResize(state);
      clearLineResize(state);
      clearCircleResize(state);

      if (mode !== 'line') {
        clearLineCreateState(state);
      }
      if (mode !== 'circle') {
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
        restLength: len,
        visible: true,
        attachmentHostStickId: null
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

      const rawPointer = { x: pointer.x, y: pointer.y };
      const previousRawPointer = state.drag.rawPointer ?? { x: rawPointer.x, y: rawPointer.y };
      let constrainedPointer = { x: rawPointer.x, y: rawPointer.y };
      if (activeNode.lineConstraintId) {
        const line = state.scene.lines[activeNode.lineConstraintId];
        if (line) {
          if (shouldReleaseFromLine(line, previousRawPointer, rawPointer)) {
            activeNode.lineConstraintId = null;
          } else {
            constrainedPointer = projectPointToInfiniteLine(constrainedPointer, line.a, line.b);
          }
        } else {
          activeNode.lineConstraintId = null;
        }
      }

      activeNode.circleConstraintId = null;
      if (!activeNode.lineConstraintId) {
        const snapLineId = hitTestLine(state.scene, constrainedPointer, LINE_SNAP_RADIUS);
        if (snapLineId) {
          const line = state.scene.lines[snapLineId];
          if (line) {
            activeNode.lineConstraintId = snapLineId;
            constrainedPointer = projectPointToInfiniteLine(constrainedPointer, line.a, line.b);
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
      state.drag.rawPointer = { x: rawPointer.x, y: rawPointer.y };

      const component = getConnectedComponent(state.scene, activeNodeId);
      const previousPositions: Record<string, Vec2> = {};
      for (const nodeId of component.nodeIds) {
        const node = state.scene.nodes[nodeId];
        previousPositions[nodeId] = { x: node.pos.x, y: node.pos.y };
      }

      const hasOtherAnchors = component.nodeIds.some(
        (nodeId) => nodeId !== activeNodeId && state.scene.nodes[nodeId].anchored
      );
      const activeIncidentStickCount = component.stickIds.reduce((count, stickId) => {
        const stick = state.scene.sticks[stickId];
        if (!stick) {
          return count;
        }
        return stick.a === activeNodeId || stick.b === activeNodeId ? count + 1 : count;
      }, 0);
      const useSoftProjection = hasOtherAnchors && activeIncidentStickCount > 1;

      const solverOptions = hasOtherAnchors
        ? {
            iterations: Math.max(state.solverOptions.iterations, CONSTRAINED_SOLVER_MIN_ITERATIONS),
            tolerancePx: Math.min(state.solverOptions.tolerancePx, CONSTRAINED_SOLVER_TOLERANCE_PX)
          }
        : state.solverOptions;

      let target = constrainedPointer;
      let mode: 'fixed' | 'soft' = hasOtherAnchors ? 'soft' : 'fixed';

      if (useSoftProjection) {
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

      recordPenTrails();
      emit();
      return { ok: true };
    },

    endDrag(): Result {
      if (!state.drag.activeNodeId) {
        return { ok: false, reason: 'No active drag.' };
      }
      state.drag.activeNodeId = null;
      state.drag.pointer = null;
      state.drag.rawPointer = null;
      lastDragUpdateMs = null;
      emit();
      return { ok: true };
    },

    beginStick(start): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const snappedStartNodeId = hitTestPivot(state.scene.nodes, start, SNAP_RADIUS);
      let startNodeId: string;
      let created = false;

      if (snappedStartNodeId) {
        startNodeId = snappedStartNodeId;
        draftStartInteriorTarget = false;
      } else {
        const interiorHit = findInteriorStickHit(state.scene, start, SNAP_RADIUS);
        if (interiorHit) {
          startNodeId = createNodeAt(interiorHit.projected);
          created = true;
          draftStartInteriorTarget = true;
        } else {
          startNodeId = createNodeAt(start);
          created = true;
          draftStartInteriorTarget = false;
        }
      }

      if (!draftStartInteriorTarget) {
        bindNodeToNearbyLine(startNodeId);
      }

      state.createStick.startNodeId = startNodeId;
      state.createStick.previewEnd = { x: start.x, y: start.y };
      draftCreatedStartNodeId = created ? startNodeId : null;
      ensureVelocityNode(startNodeId);
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

      const snappedEndNodeId = hitTestPivot(state.scene.nodes, end, SNAP_RADIUS);
      let endNodeId: string;
      let endCreated = false;
      let endPendingInteriorSplit = false;

      if (snappedEndNodeId) {
        endNodeId = snappedEndNodeId;
      } else {
        const interiorHit = findInteriorStickHit(state.scene, end, SNAP_RADIUS);
        if (interiorHit) {
          endNodeId = createNodeAt(interiorHit.projected);
          endCreated = true;
          endPendingInteriorSplit = true;
        } else {
          endNodeId = createNodeAt(end);
          endCreated = true;
        }
      }

      if (!endPendingInteriorSplit) {
        bindNodeToNearbyLine(endNodeId);
      }

      const startNode = state.scene.nodes[startNodeId];
      const endNode = state.scene.nodes[endNodeId];

      const len = distance(startNode.pos, endNode.pos);

      if (startNodeId === endNodeId || len < MIN_STICK_LENGTH) {
        if (endCreated) {
          removeNodeIfIsolated(state.scene, endNodeId);
        }
        if (draftCreatedStartNodeId) {
          removeNodeIfIsolated(state.scene, draftCreatedStartNodeId);
          draftCreatedStartNodeId = null;
        }
        draftStartInteriorTarget = false;
        clearCreateStickState(state);
        emit();
        return { ok: false, reason: 'Stick length too small or duplicate endpoints.' };
      }

      const stickId = nextStickId();
      state.scene.sticks[stickId] = {
        id: stickId,
        a: startNodeId,
        b: endNodeId,
        restLength: len,
        visible: true,
        attachmentHostStickId: null
      };

      ensureVelocityNode(startNodeId);
      ensureVelocityNode(endNodeId);

      if (draftStartInteriorTarget) {
        const startNodePos = state.scene.nodes[startNodeId].pos;
        const startTarget = findInteriorStickHit(
          state.scene,
          startNodePos,
          STICK_HIT_RADIUS,
          new Set<string>([stickId])
        );
        if (startTarget) {
          state.scene.nodes[startNodeId].pos = {
            x: startTarget.projected.x,
            y: startTarget.projected.y
          };
          attachNodeRigidToStick(startTarget.stickId, startNodeId);
        }
      }

      if (endPendingInteriorSplit) {
        const endNodePos = state.scene.nodes[endNodeId].pos;
        const endTarget = findInteriorStickHit(
          state.scene,
          endNodePos,
          STICK_HIT_RADIUS,
          new Set<string>([stickId])
        );
        if (endTarget) {
          state.scene.nodes[endNodeId].pos = {
            x: endTarget.projected.x,
            y: endTarget.projected.y
          };
          attachNodeRigidToStick(endTarget.stickId, endNodeId);
        }
      }

      draftCreatedStartNodeId = null;
      draftStartInteriorTarget = false;
      clearCreateStickState(state);
      emit();
      return { ok: true };
    },

    clearSelectionForTool(): void {
      if (state.tool === 'anchor') {
        if (state.selection.anchorNodeId || state.selection.pivotNodeId) {
          clearAllSelections(state);
          emit();
        }
        return;
      }
      if (state.tool === 'stick') {
        const hadSelection =
          state.selection.stickId || state.selection.anchorNodeId || state.selection.pivotNodeId;
        clearAllSelections(state);
        clearStickResize(state);
        if (hadSelection) {
          emit();
        }
        return;
      }
      if (state.tool === 'line') {
        const hadSelection =
          state.selection.lineId ||
          state.selection.anchorNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.circleId ||
          state.lineResize.active ||
          state.createLine.start;
        clearAllSelections(state);
        clearLineResize(state);
        clearLineCreateState(state);
        if (hadSelection) {
          emit();
        }
        return;
      }
      if (state.tool === 'pen') {
        const hadSelection =
          state.selection.anchorNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.lineId ||
          state.selection.circleId ||
          state.stickResize.active ||
          state.lineResize.active ||
          state.circleResize.active;
        clearAllSelections(state);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        if (hadSelection) {
          emit();
        }
        return;
      }
      if (state.tool === 'circle') {
        const hadSelection =
          state.selection.circleId ||
          state.selection.anchorNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.lineId ||
          state.circleResize.active ||
          state.createCircle.center;
        clearAllSelections(state);
        clearCircleResize(state);
        clearCircleCreateState(state);
        if (hadSelection) {
          emit();
        }
      }
    },

    selectAt(point) {
      if (isEditLocked()) {
        return null;
      }

      const pivotId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (pivotId) {
        const node = state.scene.nodes[pivotId];
        if (node?.anchored) {
          setAnchorSelection(state, pivotId);
          clearStickResize(state);
          clearLineResize(state);
          clearCircleResize(state);
          emit();
          return { kind: 'anchor', id: pivotId } as const;
        }
        setPivotSelection(state, pivotId);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        emit();
        return { kind: 'pivot', id: pivotId } as const;
      }

      const hitStickId = hitTestStick(state.scene, point, STICK_HIT_RADIUS);
      if (hitStickId) {
        setStickSelection(state, hitStickId);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        emit();
        return { kind: 'stick', id: hitStickId } as const;
      }

      const hitLineId = hitTestLine(state.scene, point, LINE_HIT_RADIUS);
      if (hitLineId) {
        setLineSelection(state, hitLineId);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        clearLineCreateState(state);
        emit();
        return { kind: 'line', id: hitLineId } as const;
      }

      const hadSelection =
        state.selection.anchorNodeId ||
        state.selection.pivotNodeId ||
        state.selection.stickId ||
        state.selection.lineId ||
        state.selection.circleId ||
        state.stickResize.active ||
        state.lineResize.active ||
        state.circleResize.active;
      clearAllSelections(state);
      clearStickResize(state);
      clearLineResize(state);
      clearCircleResize(state);
      if (hadSelection) {
        emit();
      }
      return null;
    },

    clearSelection(): void {
      const hadSelection =
        state.selection.anchorNodeId ||
        state.selection.pivotNodeId ||
        state.selection.stickId ||
        state.selection.lineId ||
        state.selection.circleId ||
        state.stickResize.active ||
        state.lineResize.active ||
        state.circleResize.active;
      clearAllSelections(state);
      clearStickResize(state);
      clearLineResize(state);
      clearCircleResize(state);
      if (hadSelection) {
        emit();
      }
    },

    tryHandleAnchorToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Anchor editing is disabled while physics is enabled.' };
      }
      const nodeId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (!nodeId) {
        if (state.selection.anchorNodeId || state.selection.pivotNodeId) {
          clearAllSelections(state);
          emit();
        }
        return { ok: false, reason: 'No pivot near click.' };
      }

      const node = state.scene.nodes[nodeId];
      if (!node.anchored) {
        clearAllSelections(state);
        return applyAnchorById(nodeId);
      }

      setAnchorSelection(state, nodeId);
      emit();
      return { ok: true };
    },

    tryHandleStickToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const hitStickId = hitTestStick(state.scene, point, STICK_HIT_RADIUS);
      if (hitStickId) {
        setStickSelection(state, hitStickId);
        clearStickResize(state);
        emit();
        return { ok: true };
      }

      if (state.selection.stickId || state.selection.anchorNodeId || state.selection.pivotNodeId || state.stickResize.active) {
        clearAllSelections(state);
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
        } else {
          movingNode.lineConstraintId = null;
        }
      }
      movingNode.circleConstraintId = null;
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

      const stickId = state.stickResize.stickId;
      const movingNodeId = state.stickResize.movingNodeId;
      const fixedNodeId = state.stickResize.fixedNodeId;
      if (stickId && movingNodeId && fixedNodeId) {
        const movingNode = state.scene.nodes[movingNodeId];
        const fixedNode = state.scene.nodes[fixedNodeId];
        const stick = state.scene.sticks[stickId];
        if (movingNode && fixedNode && stick) {
          const target = findInteriorStickHit(
            state.scene,
            movingNode.pos,
            STICK_HIT_RADIUS,
            new Set<string>([stickId])
          );
          if (target) {
            movingNode.pos = { x: target.projected.x, y: target.projected.y };
            attachNodeRigidToStick(target.stickId, movingNodeId);
            stick.restLength = distance(fixedNode.pos, movingNode.pos);
          }
        }
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
      setLineSelection(state, lineId);
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
        if (state.selection.lineId || state.selection.anchorNodeId || state.selection.pivotNodeId || state.selection.stickId || state.selection.circleId || state.lineResize.active) {
          clearAllSelections(state);
          clearLineResize(state);
          emit();
        }
        return { ok: false, reason: 'No line near click.' };
      }

      setLineSelection(state, lineId);
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

    setPen(nodeId): Result {
      return applySetPenByNodeId(nodeId);
    },

    tryHandlePenToolClick(point): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Pen editing is disabled while physics is enabled.' };
      }
      const nodeId = hitTestPivot(state.scene.nodes, point, PIVOT_HIT_RADIUS);
      if (!nodeId) {
        const hadSelection =
          state.selection.anchorNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.lineId ||
          state.selection.circleId;
        if (hadSelection) {
          clearAllSelections(state);
          emit();
        }
        return { ok: false, reason: 'No pivot near click.' };
      }

      const node = state.scene.nodes[nodeId];
      if (!node || node.anchored) {
        return { ok: false, reason: 'Pens can only be assigned to non-anchor pivots.' };
      }

      return applySetPenByNodeId(nodeId);
    },

    hitTestPen(point): string | null {
      return hitTestPenAtPoint(point, PEN_HIT_RADIUS);
    },

    setPenColor(nodeId, color): Result {
      const pen = state.pens[nodeId];
      if (!pen) {
        return { ok: false, reason: 'Pen does not exist.' };
      }
      if (!isHexColor(color)) {
        return { ok: false, reason: 'Color must be a hex value.' };
      }
      pen.color = color.toLowerCase();
      if (state.physics.enabled && pen.enabled) {
        const node = state.scene.nodes[nodeId];
        if (node && !node.anchored) {
          appendPenTrailPoint(nodeId, node.pos, pen.color);
        }
      }
      emit();
      return { ok: true };
    },

    setPenEnabled(nodeId, enabled): Result {
      const pen = state.pens[nodeId];
      if (!pen) {
        return { ok: false, reason: 'Pen does not exist.' };
      }
      pen.enabled = enabled;
      if (state.physics.enabled && pen.enabled) {
        const node = state.scene.nodes[nodeId];
        if (node && !node.anchored) {
          appendPenTrailPoint(nodeId, node.pos, pen.color);
        }
      }
      emit();
      return { ok: true };
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
      setCircleSelection(state, circleId);
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
        if (state.selection.circleId || state.selection.anchorNodeId || state.selection.pivotNodeId || state.selection.stickId || state.selection.lineId || state.circleResize.active) {
          clearAllSelections(state);
          clearCircleResize(state);
          emit();
        }
        return { ok: false, reason: 'No circle near click.' };
      }

      setCircleSelection(state, circleId);
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

    deleteSelectedPivot(): Result {
      const pivotId = state.selection.pivotNodeId;
      if (!pivotId) {
        return { ok: false, reason: 'No selected pivot.' };
      }
      return deletePivotById(pivotId);
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
      setPivotSelection(state, node.id);
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
        clearAllSelections(state);
        clearStickResize(state);
        clearLineResize(state);
        clearCircleResize(state);
        state.tool = 'idle';
        state.drag.activeNodeId = null;
        state.drag.pointer = null;
        state.drag.rawPointer = null;
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
        state.drag.rawPointer = null;
        lastDragUpdateMs = null;
      }

      state.physics.enabled = enabled;
      resetAllVelocities();
      if (enabled) {
        beginPenTrailSession();
      }
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

      recordPenTrails();
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
