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
import type {
  AttachmentConstraint,
  PhysicsDiagnostics,
  PhysicsOptions,
  Result,
  Scene,
  SceneStore,
  SceneStoreState,
  Vec2
} from './types';

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
const PHYSICS_DEFAULT_SUBSTEPS = 4;
const PHYSICS_DEFAULT_CONSTRAINT_ITERATIONS = 12;
const PHYSICS_DEFAULT_POSITION_TOLERANCE = 1e-4;
const PHYSICS_DEFAULT_VELOCITY_TOLERANCE = 1e-5;
const PHYSICS_MAX_SUBSTEPS = 16;
const PHYSICS_MAX_CONSTRAINT_ITERATIONS = 64;
const PHYSICS_ENERGY_EPSILON = 1e-9;
const PHYSICS_STRICT_ENERGY_MAX_RESIDUAL = 0.35;
const PHYSICS_DIAGNOSTIC_HISTORY_MAX = 512;
const ATTACHMENT_ENDPOINT_EPSILON = 1e-6;
const CONSTRAINT_RELEASE_DISTANCE = 16;
const CONSTRAINT_RELEASE_DIRECTION_RATIO = 1.25;
const CONSTRAINT_RELEASE_MIN_STEP = 1.5;

const DEFAULT_PHYSICS_OPTIONS: PhysicsOptions = {
  substeps: PHYSICS_DEFAULT_SUBSTEPS,
  constraintIterations: PHYSICS_DEFAULT_CONSTRAINT_ITERATIONS,
  positionTolerance: PHYSICS_DEFAULT_POSITION_TOLERANCE,
  velocityTolerance: PHYSICS_DEFAULT_VELOCITY_TOLERANCE,
  integratorMode: 'rattle_symplectic',
  massModel: 'node_mass',
  energyMode: 'strict'
};

const DEFAULT_PHYSICS_DIAGNOSTICS: PhysicsDiagnostics = {
  totalKineticEnergy: 0,
  angularMomentumAboutAnchor: 0,
  constraintViolationL2: 0,
  constraintViolationMax: 0,
  energyRescaleSkippedDueHighResidual: false,
  energyRescaleResidualMax: 0,
  relativeJointAngle: null,
  relativeJointAngleHistory: []
};

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
    attachments: {},
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
    circleConstraintId: null,
    attachmentId: null
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
    if (node.attachmentId) {
      delete scene.attachments[node.attachmentId];
    }
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

function clearPenSelection(state: SceneStoreState): void {
  state.selection.penNodeId = null;
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
  clearPenSelection(state);
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

function setPenSelection(state: SceneStoreState, nodeId: string): void {
  clearAllSelections(state);
  state.selection.penNodeId = nodeId;
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

function enforceComponentConstraints(
  scene: Scene,
  nodeIds: string[],
  stickIds: string[],
  fixedNodeIds: Set<string>,
  iterations: number
): void {
  const epsilon = 1e-6;
  const nodeIdSet = new Set(nodeIds);
  const stickIdSet = new Set(stickIds);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const stickId of stickIds) {
      const stick = scene.sticks[stickId];
      if (!stick || stick.visible === false) {
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

    for (const attachment of Object.values(scene.attachments)) {
      const attachedNode = scene.nodes[attachment.nodeId];
      const hostStick = scene.sticks[attachment.hostStickId];
      if (!attachedNode || !hostStick || hostStick.visible === false) {
        continue;
      }
      if (!stickIdSet.has(hostStick.id)) {
        continue;
      }
      if (
        !nodeIdSet.has(attachment.nodeId) ||
        !nodeIdSet.has(hostStick.a) ||
        !nodeIdSet.has(hostStick.b)
      ) {
        continue;
      }
      const hostA = scene.nodes[hostStick.a];
      const hostB = scene.nodes[hostStick.b];
      if (!hostA || !hostB) {
        continue;
      }

      const t = attachment.t;
      const oneMinusT = 1 - t;
      const solveAxis = (axis: 'x' | 'y'): void => {
        const c =
          attachedNode.pos[axis] - (oneMinusT * hostA.pos[axis] + t * hostB.pos[axis]);
        if (Math.abs(c) <= epsilon) {
          return;
        }

        const invA = fixedNodeIds.has(hostA.id) ? 0 : 1;
        const invB = fixedNodeIds.has(hostB.id) ? 0 : 1;
        const invH = fixedNodeIds.has(attachedNode.id) ? 0 : 1;
        const denom = oneMinusT * oneMinusT * invA + t * t * invB + invH;
        if (denom <= epsilon) {
          return;
        }

        const deltaLambda = -c / denom;
        if (invA > 0) {
          hostA.pos[axis] += invA * (-oneMinusT) * deltaLambda;
        }
        if (invB > 0) {
          hostB.pos[axis] += invB * (-t) * deltaLambda;
        }
        if (invH > 0) {
          attachedNode.pos[axis] += invH * deltaLambda;
        }
      };

      solveAxis('x');
      solveAxis('y');
    }
  }
}

export function createSceneStore(): SceneStore {
  let nodeCounter = 0;
  let stickCounter = 0;
  let attachmentCounter = 0;
  let lineCounter = 0;
  let circleCounter = 0;
  let draftCreatedStartNodeId: string | null = null;
  let draftStartInteriorTarget = false;
  let lastDragUpdateMs: number | null = null;
  const velocities: Record<string, Vec2> = {};
  const positionDistanceLambdas: Record<string, number> = {};
  const positionLineLambdas: Record<string, number> = {};
  const positionAttachmentXLambdas: Record<string, number> = {};
  const positionAttachmentYLambdas: Record<string, number> = {};
  const velocityDistanceLambdas: Record<string, number> = {};
  const velocityLineLambdas: Record<string, number> = {};
  const velocityAttachmentXLambdas: Record<string, number> = {};
  const velocityAttachmentYLambdas: Record<string, number> = {};

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
      penNodeId: null,
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
    physicsOptions: { ...DEFAULT_PHYSICS_OPTIONS },
    physicsDiagnostics: { ...DEFAULT_PHYSICS_DIAGNOSTICS, relativeJointAngleHistory: [] },
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

  const nextAttachmentId = (): string => {
    attachmentCounter += 1;
    return `attachment-${attachmentCounter}`;
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
      circleConstraintId: null,
      attachmentId: null
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

  const ensureVelocityNode = (nodeId: string): void => {
    if (!velocities[nodeId]) {
      velocities[nodeId] = { x: 0, y: 0 };
    }
  };

  const detachAttachmentById = (attachmentId: string): void => {
    const attachment = state.scene.attachments[attachmentId];
    if (!attachment) {
      return;
    }
    const node = state.scene.nodes[attachment.nodeId];
    if (node && node.attachmentId === attachmentId) {
      node.attachmentId = null;
    }
    delete state.scene.attachments[attachmentId];
  };

  const detachNodeAttachment = (nodeId: string): void => {
    const node = state.scene.nodes[nodeId];
    if (!node?.attachmentId) {
      return;
    }
    detachAttachmentById(node.attachmentId);
  };

  const detachAttachmentsForHostStick = (hostStickId: string): void => {
    const attachmentIds = Object.values(state.scene.attachments)
      .filter((attachment) => attachment.hostStickId === hostStickId)
      .map((attachment) => attachment.id);
    for (const attachmentId of attachmentIds) {
      detachAttachmentById(attachmentId);
    }
  };

  const updateAttachmentNodePosition = (attachmentId: string): void => {
    const attachment = state.scene.attachments[attachmentId];
    if (!attachment) {
      return;
    }
    const node = state.scene.nodes[attachment.nodeId];
    const hostStick = state.scene.sticks[attachment.hostStickId];
    if (!node || !hostStick || hostStick.visible === false) {
      detachAttachmentById(attachmentId);
      return;
    }
    const hostA = state.scene.nodes[hostStick.a];
    const hostB = state.scene.nodes[hostStick.b];
    if (!hostA || !hostB) {
      detachAttachmentById(attachmentId);
      return;
    }
    const t = attachment.t;
    node.pos.x = hostA.pos.x * (1 - t) + hostB.pos.x * t;
    node.pos.y = hostA.pos.y * (1 - t) + hostB.pos.y * t;
  };

  const attachNodeToHostStick = (hostStickId: string, nodeId: string): boolean => {
    const node = state.scene.nodes[nodeId];
    const hostStick = state.scene.sticks[hostStickId];
    if (!node || !hostStick || hostStick.visible === false) {
      return false;
    }
    if (hostStick.a === nodeId || hostStick.b === nodeId) {
      return false;
    }
    const hostA = state.scene.nodes[hostStick.a];
    const hostB = state.scene.nodes[hostStick.b];
    if (!hostA || !hostB) {
      return false;
    }

    const projection = projectPointToSegment(node.pos, hostA.pos, hostB.pos);
    if (
      projection.t <= ATTACHMENT_ENDPOINT_EPSILON ||
      projection.t >= 1 - ATTACHMENT_ENDPOINT_EPSILON
    ) {
      return false;
    }

    if (node.attachmentId) {
      const existing = state.scene.attachments[node.attachmentId];
      if (existing) {
        if (existing.hostStickId === hostStickId) {
          existing.t = projection.t;
          node.lineConstraintId = null;
          node.circleConstraintId = null;
          updateAttachmentNodePosition(existing.id);
          return true;
        }
      }
      detachNodeAttachment(nodeId);
    }

    const attachmentId = nextAttachmentId();
    const attachment: AttachmentConstraint = {
      id: attachmentId,
      nodeId,
      hostStickId,
      t: projection.t
    };
    state.scene.attachments[attachmentId] = attachment;
    node.attachmentId = attachmentId;
    node.lineConstraintId = null;
    node.circleConstraintId = null;
    updateAttachmentNodePosition(attachmentId);
    ensureVelocityNode(nodeId);
    return true;
  };

  const pruneAttachments = (): void => {
    for (const attachment of Object.values(state.scene.attachments)) {
      const node = state.scene.nodes[attachment.nodeId];
      const host = state.scene.sticks[attachment.hostStickId];
      if (!node || !host || host.visible === false) {
        detachAttachmentById(attachment.id);
        continue;
      }
      if (node.attachmentId !== attachment.id) {
        node.attachmentId = attachment.id;
      }
    }
    for (const node of Object.values(state.scene.nodes)) {
      if (!node.attachmentId) {
        continue;
      }
      if (!state.scene.attachments[node.attachmentId]) {
        node.attachmentId = null;
      }
    }
  };

  const removePenForNode = (nodeId: string): void => {
    if (state.selection.penNodeId === nodeId) {
      clearPenSelection(state);
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

  type DistanceConstraint = {
    key: string;
    aId: string;
    bId: string;
    restLength: number;
  };

  type LineConstraintRef = {
    key: string;
    nodeId: string;
    ax: number;
    ay: number;
    nx: number;
    ny: number;
  };

  type AttachmentConstraintRef = {
    key: string;
    nodeId: string;
    hostAId: string;
    hostBId: string;
    t: number;
  };

  const clampInteger = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, Math.round(value)));
  };

  const clampPositive = (value: number, fallback: number): number => {
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return value;
  };

  const getInverseMass = (nodeId: string): number => {
    const node = state.scene.nodes[nodeId];
    if (!node || node.anchored) {
      return 0;
    }
    return 1;
  };

  const gatherDistanceConstraints = (): DistanceConstraint[] =>
    Object.values(state.scene.sticks)
      .filter((stick) => stick.visible !== false)
      .map((stick) => ({
        key: stick.id,
        aId: stick.a,
        bId: stick.b,
        restLength: stick.restLength
      }));

  const gatherLineConstraints = (): LineConstraintRef[] => {
    const result: LineConstraintRef[] = [];
    for (const node of Object.values(state.scene.nodes)) {
      if (node.anchored || !node.lineConstraintId) {
        continue;
      }
      const line = state.scene.lines[node.lineConstraintId];
      if (!line) {
        continue;
      }
      const dx = line.b.x - line.a.x;
      const dy = line.b.y - line.a.y;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-9) {
        continue;
      }
      result.push({
        key: `${node.id}:${line.id}`,
        nodeId: node.id,
        ax: line.a.x,
        ay: line.a.y,
        nx: -dy / len,
        ny: dx / len
      });
    }
    return result;
  };

  const gatherAttachmentConstraints = (): AttachmentConstraintRef[] => {
    const result: AttachmentConstraintRef[] = [];
    for (const attachment of Object.values(state.scene.attachments)) {
      const node = state.scene.nodes[attachment.nodeId];
      const host = state.scene.sticks[attachment.hostStickId];
      if (!node || !host || host.visible === false) {
        continue;
      }
      if (!state.scene.nodes[host.a] || !state.scene.nodes[host.b]) {
        continue;
      }
      result.push({
        key: attachment.id,
        nodeId: attachment.nodeId,
        hostAId: host.a,
        hostBId: host.b,
        t: attachment.t
      });
    }
    return result;
  };

  const applyDistanceLambdaToPositions = (constraint: DistanceConstraint, lambda: number): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const a = state.scene.nodes[constraint.aId];
    const b = state.scene.nodes[constraint.bId];
    if (!a || !b) {
      return;
    }
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) {
      return;
    }
    const nx = dx / len;
    const ny = dy / len;
    const invMa = getInverseMass(a.id);
    const invMb = getInverseMass(b.id);
    if (invMa + invMb <= 1e-9) {
      return;
    }
    a.pos.x += -invMa * nx * lambda;
    a.pos.y += -invMa * ny * lambda;
    b.pos.x += invMb * nx * lambda;
    b.pos.y += invMb * ny * lambda;
  };

  const applyLineLambdaToPosition = (constraint: LineConstraintRef, lambda: number): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const node = state.scene.nodes[constraint.nodeId];
    if (!node) {
      return;
    }
    const invMass = getInverseMass(node.id);
    if (invMass <= 1e-9) {
      return;
    }
    node.pos.x += invMass * constraint.nx * lambda;
    node.pos.y += invMass * constraint.ny * lambda;
  };

  const applyAttachmentLambdaToPosition = (
    constraint: AttachmentConstraintRef,
    axis: 'x' | 'y',
    lambda: number
  ): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const hostA = state.scene.nodes[constraint.hostAId];
    const hostB = state.scene.nodes[constraint.hostBId];
    const node = state.scene.nodes[constraint.nodeId];
    if (!hostA || !hostB || !node) {
      return;
    }

    const t = constraint.t;
    const oneMinusT = 1 - t;
    const invA = getInverseMass(hostA.id);
    const invB = getInverseMass(hostB.id);
    const invH = getInverseMass(node.id);
    if (invA + invB + invH <= 1e-9) {
      return;
    }

    hostA.pos[axis] += invA * (-oneMinusT) * lambda;
    hostB.pos[axis] += invB * (-t) * lambda;
    node.pos[axis] += invH * lambda;
  };

  const applyDistanceLambdaToVelocities = (constraint: DistanceConstraint, lambda: number): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const a = state.scene.nodes[constraint.aId];
    const b = state.scene.nodes[constraint.bId];
    if (!a || !b) {
      return;
    }
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const len = Math.hypot(dx, dy);
    if (len <= 1e-9) {
      return;
    }
    const nx = dx / len;
    const ny = dy / len;
    const invMa = getInverseMass(a.id);
    const invMb = getInverseMass(b.id);
    if (invMa + invMb <= 1e-9) {
      return;
    }
    ensureVelocityNode(a.id);
    ensureVelocityNode(b.id);
    velocities[a.id].x += -invMa * nx * lambda;
    velocities[a.id].y += -invMa * ny * lambda;
    velocities[b.id].x += invMb * nx * lambda;
    velocities[b.id].y += invMb * ny * lambda;
  };

  const applyLineLambdaToVelocity = (constraint: LineConstraintRef, lambda: number): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const node = state.scene.nodes[constraint.nodeId];
    if (!node) {
      return;
    }
    const invMass = getInverseMass(node.id);
    if (invMass <= 1e-9) {
      return;
    }
    ensureVelocityNode(node.id);
    velocities[node.id].x += invMass * constraint.nx * lambda;
    velocities[node.id].y += invMass * constraint.ny * lambda;
  };

  const applyAttachmentLambdaToVelocity = (
    constraint: AttachmentConstraintRef,
    axis: 'x' | 'y',
    lambda: number
  ): void => {
    if (!Number.isFinite(lambda) || Math.abs(lambda) <= 1e-12) {
      return;
    }
    const hostA = state.scene.nodes[constraint.hostAId];
    const hostB = state.scene.nodes[constraint.hostBId];
    const node = state.scene.nodes[constraint.nodeId];
    if (!hostA || !hostB || !node) {
      return;
    }

    const t = constraint.t;
    const oneMinusT = 1 - t;
    const invA = getInverseMass(hostA.id);
    const invB = getInverseMass(hostB.id);
    const invH = getInverseMass(node.id);
    if (invA + invB + invH <= 1e-9) {
      return;
    }

    ensureVelocityNode(hostA.id);
    ensureVelocityNode(hostB.id);
    ensureVelocityNode(node.id);
    velocities[hostA.id][axis] += invA * (-oneMinusT) * lambda;
    velocities[hostB.id][axis] += invB * (-t) * lambda;
    velocities[node.id][axis] += invH * lambda;
  };

  const applyWarmStartPosition = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[]
  ): void => {
    for (const constraint of distanceConstraints) {
      applyDistanceLambdaToPositions(constraint, positionDistanceLambdas[constraint.key] ?? 0);
    }
    for (const constraint of lineConstraints) {
      applyLineLambdaToPosition(constraint, positionLineLambdas[constraint.key] ?? 0);
    }
    for (const constraint of attachmentConstraints) {
      applyAttachmentLambdaToPosition(
        constraint,
        'x',
        positionAttachmentXLambdas[constraint.key] ?? 0
      );
      applyAttachmentLambdaToPosition(
        constraint,
        'y',
        positionAttachmentYLambdas[constraint.key] ?? 0
      );
    }
  };

  const applyWarmStartVelocity = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[]
  ): void => {
    for (const constraint of distanceConstraints) {
      applyDistanceLambdaToVelocities(constraint, velocityDistanceLambdas[constraint.key] ?? 0);
    }
    for (const constraint of lineConstraints) {
      applyLineLambdaToVelocity(constraint, velocityLineLambdas[constraint.key] ?? 0);
    }
    for (const constraint of attachmentConstraints) {
      applyAttachmentLambdaToVelocity(
        constraint,
        'x',
        velocityAttachmentXLambdas[constraint.key] ?? 0
      );
      applyAttachmentLambdaToVelocity(
        constraint,
        'y',
        velocityAttachmentYLambdas[constraint.key] ?? 0
      );
    }
  };

  const solvePositionConstraintsRattle = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[],
    iterations: number,
    tolerance: number
  ): void => {
    for (let i = 0; i < iterations; i += 1) {
      for (const constraint of distanceConstraints) {
        const a = state.scene.nodes[constraint.aId];
        const b = state.scene.nodes[constraint.bId];
        if (!a || !b) {
          continue;
        }
        const invMa = getInverseMass(a.id);
        const invMb = getInverseMass(b.id);
        const weight = invMa + invMb;
        if (weight <= 1e-9) {
          continue;
        }

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 1e-9) {
          continue;
        }
        const c = dist - constraint.restLength;
        if (Math.abs(c) <= tolerance) {
          continue;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const deltaLambda = -c / weight;
        positionDistanceLambdas[constraint.key] =
          (positionDistanceLambdas[constraint.key] ?? 0) + deltaLambda;

        a.pos.x += -invMa * nx * deltaLambda;
        a.pos.y += -invMa * ny * deltaLambda;
        b.pos.x += invMb * nx * deltaLambda;
        b.pos.y += invMb * ny * deltaLambda;
      }

      for (const constraint of lineConstraints) {
        const node = state.scene.nodes[constraint.nodeId];
        if (!node) {
          continue;
        }
        const invMass = getInverseMass(node.id);
        if (invMass <= 1e-9) {
          continue;
        }
        const c =
          constraint.nx * (node.pos.x - constraint.ax) +
          constraint.ny * (node.pos.y - constraint.ay);
        if (Math.abs(c) <= tolerance) {
          continue;
        }

        const deltaLambda = -c / invMass;
        positionLineLambdas[constraint.key] = (positionLineLambdas[constraint.key] ?? 0) + deltaLambda;

        node.pos.x += invMass * constraint.nx * deltaLambda;
        node.pos.y += invMass * constraint.ny * deltaLambda;
      }

      for (const constraint of attachmentConstraints) {
        const hostA = state.scene.nodes[constraint.hostAId];
        const hostB = state.scene.nodes[constraint.hostBId];
        const node = state.scene.nodes[constraint.nodeId];
        if (!hostA || !hostB || !node) {
          continue;
        }
        const t = constraint.t;
        const oneMinusT = 1 - t;
        const invA = getInverseMass(hostA.id);
        const invB = getInverseMass(hostB.id);
        const invH = getInverseMass(node.id);
        const denom = oneMinusT * oneMinusT * invA + t * t * invB + invH;
        if (denom <= 1e-9) {
          continue;
        }

        const solveAxis = (axis: 'x' | 'y'): void => {
          const c = node.pos[axis] - (oneMinusT * hostA.pos[axis] + t * hostB.pos[axis]);
          if (Math.abs(c) <= tolerance) {
            return;
          }
          const deltaLambda = -c / denom;
          if (axis === 'x') {
            positionAttachmentXLambdas[constraint.key] =
              (positionAttachmentXLambdas[constraint.key] ?? 0) + deltaLambda;
          } else {
            positionAttachmentYLambdas[constraint.key] =
              (positionAttachmentYLambdas[constraint.key] ?? 0) + deltaLambda;
          }
          hostA.pos[axis] += invA * (-oneMinusT) * deltaLambda;
          hostB.pos[axis] += invB * (-t) * deltaLambda;
          node.pos[axis] += invH * deltaLambda;
        };

        solveAxis('x');
        solveAxis('y');
      }
    }
  };

  const solveVelocityConstraintsRattle = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[],
    iterations: number,
    tolerance: number
  ): void => {
    for (let i = 0; i < iterations; i += 1) {
      for (const constraint of distanceConstraints) {
        const a = state.scene.nodes[constraint.aId];
        const b = state.scene.nodes[constraint.bId];
        if (!a || !b) {
          continue;
        }
        const invMa = getInverseMass(a.id);
        const invMb = getInverseMass(b.id);
        const weight = invMa + invMb;
        if (weight <= 1e-9) {
          continue;
        }
        ensureVelocityNode(a.id);
        ensureVelocityNode(b.id);

        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 1e-9) {
          continue;
        }
        const nx = dx / dist;
        const ny = dy / dist;
        const rel =
          nx * (velocities[b.id].x - velocities[a.id].x) +
          ny * (velocities[b.id].y - velocities[a.id].y);
        if (Math.abs(rel) <= tolerance) {
          continue;
        }

        const deltaLambda = -rel / weight;
        velocityDistanceLambdas[constraint.key] =
          (velocityDistanceLambdas[constraint.key] ?? 0) + deltaLambda;
        velocities[a.id].x += -invMa * nx * deltaLambda;
        velocities[a.id].y += -invMa * ny * deltaLambda;
        velocities[b.id].x += invMb * nx * deltaLambda;
        velocities[b.id].y += invMb * ny * deltaLambda;
      }

      for (const constraint of lineConstraints) {
        const node = state.scene.nodes[constraint.nodeId];
        if (!node) {
          continue;
        }
        const invMass = getInverseMass(node.id);
        if (invMass <= 1e-9) {
          continue;
        }
        ensureVelocityNode(node.id);
        const rel = constraint.nx * velocities[node.id].x + constraint.ny * velocities[node.id].y;
        if (Math.abs(rel) <= tolerance) {
          continue;
        }
        const deltaLambda = -rel / invMass;
        velocityLineLambdas[constraint.key] = (velocityLineLambdas[constraint.key] ?? 0) + deltaLambda;
        velocities[node.id].x += invMass * constraint.nx * deltaLambda;
        velocities[node.id].y += invMass * constraint.ny * deltaLambda;
      }

      for (const constraint of attachmentConstraints) {
        const hostA = state.scene.nodes[constraint.hostAId];
        const hostB = state.scene.nodes[constraint.hostBId];
        const node = state.scene.nodes[constraint.nodeId];
        if (!hostA || !hostB || !node) {
          continue;
        }
        const t = constraint.t;
        const oneMinusT = 1 - t;
        const invA = getInverseMass(hostA.id);
        const invB = getInverseMass(hostB.id);
        const invH = getInverseMass(node.id);
        const denom = oneMinusT * oneMinusT * invA + t * t * invB + invH;
        if (denom <= 1e-9) {
          continue;
        }

        ensureVelocityNode(hostA.id);
        ensureVelocityNode(hostB.id);
        ensureVelocityNode(node.id);

        const solveAxis = (axis: 'x' | 'y'): void => {
          const rel =
            velocities[node.id][axis] -
            (oneMinusT * velocities[hostA.id][axis] + t * velocities[hostB.id][axis]);
          if (Math.abs(rel) <= tolerance) {
            return;
          }
          const deltaLambda = -rel / denom;
          if (axis === 'x') {
            velocityAttachmentXLambdas[constraint.key] =
              (velocityAttachmentXLambdas[constraint.key] ?? 0) + deltaLambda;
          } else {
            velocityAttachmentYLambdas[constraint.key] =
              (velocityAttachmentYLambdas[constraint.key] ?? 0) + deltaLambda;
          }
          velocities[hostA.id][axis] += invA * (-oneMinusT) * deltaLambda;
          velocities[hostB.id][axis] += invB * (-t) * deltaLambda;
          velocities[node.id][axis] += invH * deltaLambda;
        };

        solveAxis('x');
        solveAxis('y');
      }
    }
  };

  const evaluateConstraintViolation = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[]
  ): { max: number; l2: number } => {
    let max = 0;
    let sumSq = 0;
    let count = 0;

    for (const constraint of distanceConstraints) {
      const a = state.scene.nodes[constraint.aId];
      const b = state.scene.nodes[constraint.bId];
      if (!a || !b) {
        continue;
      }
      const err = Math.abs(distance(a.pos, b.pos) - constraint.restLength);
      max = Math.max(max, err);
      sumSq += err * err;
      count += 1;
    }

    for (const constraint of lineConstraints) {
      const node = state.scene.nodes[constraint.nodeId];
      if (!node) {
        continue;
      }
      const err = Math.abs(
        constraint.nx * (node.pos.x - constraint.ax) +
        constraint.ny * (node.pos.y - constraint.ay)
      );
      max = Math.max(max, err);
      sumSq += err * err;
      count += 1;
    }

    for (const constraint of attachmentConstraints) {
      const hostA = state.scene.nodes[constraint.hostAId];
      const hostB = state.scene.nodes[constraint.hostBId];
      const node = state.scene.nodes[constraint.nodeId];
      if (!hostA || !hostB || !node) {
        continue;
      }
      const t = constraint.t;
      const oneMinusT = 1 - t;
      const errX = node.pos.x - (oneMinusT * hostA.pos.x + t * hostB.pos.x);
      const errY = node.pos.y - (oneMinusT * hostA.pos.y + t * hostB.pos.y);
      const err = Math.hypot(errX, errY);
      max = Math.max(max, err);
      sumSq += err * err;
      count += 1;
    }

    return {
      max,
      l2: Math.sqrt(sumSq / Math.max(1, count))
    };
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

  const computeAngularMomentumAboutAnchor = (): number => {
    const anchors = Object.values(state.scene.nodes)
      .filter((node) => node.anchored)
      .sort((a, b) => a.id.localeCompare(b.id));
    let reference: Vec2 = { x: 0, y: 0 };
    if (anchors.length > 0) {
      reference = { x: anchors[0].pos.x, y: anchors[0].pos.y };
    } else {
      const nodes = Object.values(state.scene.nodes);
      if (nodes.length > 0) {
        reference = {
          x: nodes.reduce((sum, node) => sum + node.pos.x, 0) / nodes.length,
          y: nodes.reduce((sum, node) => sum + node.pos.y, 0) / nodes.length
        };
      }
    }

    let angularMomentum = 0;
    for (const node of Object.values(state.scene.nodes)) {
      if (node.anchored) {
        continue;
      }
      ensureVelocityNode(node.id);
      const rX = node.pos.x - reference.x;
      const rY = node.pos.y - reference.y;
      angularMomentum += rX * velocities[node.id].y - rY * velocities[node.id].x;
    }
    return angularMomentum;
  };

  const computeRelativeJointAngle = (): number | null => {
    const visibleSticks = Object.values(state.scene.sticks).filter((stick) => stick.visible !== false);
    const sticksByNode: Record<string, string[]> = {};
    for (const stick of visibleSticks) {
      if (!sticksByNode[stick.a]) {
        sticksByNode[stick.a] = [];
      }
      if (!sticksByNode[stick.b]) {
        sticksByNode[stick.b] = [];
      }
      sticksByNode[stick.a].push(stick.id);
      sticksByNode[stick.b].push(stick.id);
    }

    const jointNodeId = Object.keys(sticksByNode)
      .sort()
      .find((nodeId) => sticksByNode[nodeId].length >= 2);
    if (!jointNodeId) {
      return null;
    }

    const [firstStickId, secondStickId] = sticksByNode[jointNodeId]
      .slice()
      .sort((a, b) => a.localeCompare(b));
    if (!firstStickId || !secondStickId) {
      return null;
    }
    const firstStick = state.scene.sticks[firstStickId];
    const secondStick = state.scene.sticks[secondStickId];
    if (!firstStick || !secondStick) {
      return null;
    }

    const firstOtherId = firstStick.a === jointNodeId ? firstStick.b : firstStick.a;
    const secondOtherId = secondStick.a === jointNodeId ? secondStick.b : secondStick.a;
    const joint = state.scene.nodes[jointNodeId];
    const first = state.scene.nodes[firstOtherId];
    const second = state.scene.nodes[secondOtherId];
    if (!joint || !first || !second) {
      return null;
    }

    const v1x = first.pos.x - joint.pos.x;
    const v1y = first.pos.y - joint.pos.y;
    const v2x = second.pos.x - joint.pos.x;
    const v2y = second.pos.y - joint.pos.y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 <= 1e-9 || m2 <= 1e-9) {
      return null;
    }

    return Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
  };

  const updatePhysicsDiagnostics = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[],
    energyRescaleSkippedDueHighResidual = false,
    energyRescaleResidualMax = 0
  ): void => {
    const constraintViolation = evaluateConstraintViolation(
      distanceConstraints,
      lineConstraints,
      attachmentConstraints
    );
    const relativeJointAngle = computeRelativeJointAngle();
    const previousHistory = state.physicsDiagnostics.relativeJointAngleHistory;
    const nextHistory =
      relativeJointAngle === null
        ? []
        : [...previousHistory, relativeJointAngle].slice(-PHYSICS_DIAGNOSTIC_HISTORY_MAX);

    state.physicsDiagnostics = {
      totalKineticEnergy: computeKineticEnergy(),
      angularMomentumAboutAnchor: computeAngularMomentumAboutAnchor(),
      constraintViolationL2: constraintViolation.l2,
      constraintViolationMax: constraintViolation.max,
      energyRescaleSkippedDueHighResidual,
      energyRescaleResidualMax,
      relativeJointAngle,
      relativeJointAngleHistory: nextHistory
    };
  };

  const clearConstraintLambdas = (): void => {
    for (const map of [
      positionDistanceLambdas,
      positionLineLambdas,
      positionAttachmentXLambdas,
      positionAttachmentYLambdas,
      velocityDistanceLambdas,
      velocityLineLambdas,
      velocityAttachmentXLambdas,
      velocityAttachmentYLambdas
    ]) {
      for (const key of Object.keys(map)) {
        delete map[key];
      }
    }
  };

  const pruneConstraintLambdas = (
    distanceConstraints: DistanceConstraint[],
    lineConstraints: LineConstraintRef[],
    attachmentConstraints: AttachmentConstraintRef[]
  ): void => {
    const activeDistanceKeys = new Set(distanceConstraints.map((constraint) => constraint.key));
    const activeLineKeys = new Set(lineConstraints.map((constraint) => constraint.key));
    const activeAttachmentKeys = new Set(attachmentConstraints.map((constraint) => constraint.key));
    for (const key of Object.keys(positionDistanceLambdas)) {
      if (!activeDistanceKeys.has(key)) {
        delete positionDistanceLambdas[key];
      }
    }
    for (const key of Object.keys(velocityDistanceLambdas)) {
      if (!activeDistanceKeys.has(key)) {
        delete velocityDistanceLambdas[key];
      }
    }
    for (const key of Object.keys(positionLineLambdas)) {
      if (!activeLineKeys.has(key)) {
        delete positionLineLambdas[key];
      }
    }
    for (const key of Object.keys(velocityLineLambdas)) {
      if (!activeLineKeys.has(key)) {
        delete velocityLineLambdas[key];
      }
    }
    for (const key of Object.keys(positionAttachmentXLambdas)) {
      if (!activeAttachmentKeys.has(key)) {
        delete positionAttachmentXLambdas[key];
      }
    }
    for (const key of Object.keys(positionAttachmentYLambdas)) {
      if (!activeAttachmentKeys.has(key)) {
        delete positionAttachmentYLambdas[key];
      }
    }
    for (const key of Object.keys(velocityAttachmentXLambdas)) {
      if (!activeAttachmentKeys.has(key)) {
        delete velocityAttachmentXLambdas[key];
      }
    }
    for (const key of Object.keys(velocityAttachmentYLambdas)) {
      if (!activeAttachmentKeys.has(key)) {
        delete velocityAttachmentYLambdas[key];
      }
    }
  };

  const runRattleSymplecticSubstep = (dt: number): void => {
    const distanceConstraints = gatherDistanceConstraints();
    const lineConstraints = gatherLineConstraints();
    const attachmentConstraints = gatherAttachmentConstraints();
    pruneConstraintLambdas(distanceConstraints, lineConstraints, attachmentConstraints);
    const energyBeforeConstraints = computeKineticEnergy();

    const predictedPositions: Record<string, Vec2> = {};
    for (const node of Object.values(state.scene.nodes)) {
      ensureVelocityNode(node.id);
      if (node.anchored) {
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
        continue;
      }
      node.pos.x += velocities[node.id].x * dt;
      node.pos.y += velocities[node.id].y * dt;
      predictedPositions[node.id] = { x: node.pos.x, y: node.pos.y };
    }

    applyWarmStartPosition(distanceConstraints, lineConstraints, attachmentConstraints);
    solvePositionConstraintsRattle(
      distanceConstraints,
      lineConstraints,
      attachmentConstraints,
      state.physicsOptions.constraintIterations,
      state.physicsOptions.positionTolerance
    );

    // RATTLE: convert position-constraint correction into a consistent velocity impulse.
    for (const node of Object.values(state.scene.nodes)) {
      if (node.anchored) {
        continue;
      }
      const predicted = predictedPositions[node.id];
      if (!predicted) {
        continue;
      }
      velocities[node.id].x += (node.pos.x - predicted.x) / dt;
      velocities[node.id].y += (node.pos.y - predicted.y) / dt;
    }

    applyWarmStartVelocity(distanceConstraints, lineConstraints, attachmentConstraints);
    solveVelocityConstraintsRattle(
      distanceConstraints,
      lineConstraints,
      attachmentConstraints,
      state.physicsOptions.constraintIterations,
      state.physicsOptions.velocityTolerance
    );

    for (const node of Object.values(state.scene.nodes)) {
      if (!node.anchored) {
        continue;
      }
      velocities[node.id].x = 0;
      velocities[node.id].y = 0;
      node.circleConstraintId = null;
    }

    // With no forces/friction, numerical constraint solves should not dissipate energy.
    const energyAfterConstraints = computeKineticEnergy();
    const violationAfterConstraints = evaluateConstraintViolation(
      distanceConstraints,
      lineConstraints,
      attachmentConstraints
    );
    let energyRescaleSkippedDueHighResidual = false;
    if (energyBeforeConstraints <= PHYSICS_ENERGY_EPSILON) {
      for (const node of Object.values(state.scene.nodes)) {
        if (node.anchored) {
          continue;
        }
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
      }
    } else if (state.physicsOptions.energyMode === 'strict') {
      if (violationAfterConstraints.max > PHYSICS_STRICT_ENERGY_MAX_RESIDUAL) {
        energyRescaleSkippedDueHighResidual = true;
      } else if (energyAfterConstraints > PHYSICS_ENERGY_EPSILON) {
        const scale = Math.sqrt(energyBeforeConstraints / energyAfterConstraints);
        if (Number.isFinite(scale) && Math.abs(scale - 1) > 1e-12) {
          for (const node of Object.values(state.scene.nodes)) {
            if (node.anchored) {
              continue;
            }
            velocities[node.id].x *= scale;
            velocities[node.id].y *= scale;
          }
        }
      }
    }

    updatePhysicsDiagnostics(
      distanceConstraints,
      lineConstraints,
      attachmentConstraints,
      energyRescaleSkippedDueHighResidual,
      violationAfterConstraints.max
    );
  };

  const runLegacyProjectionSubstep = (dt: number): void => {
    const nodeIds = Object.keys(state.scene.nodes);
    const stickIds = Object.values(state.scene.sticks)
      .filter((stick) => stick.visible !== false)
      .map((stick) => stick.id);
    const fixedNodeIds = new Set<string>(
      nodeIds.filter((nodeId) => state.scene.nodes[nodeId].anchored)
    );
    const previousPositions: Record<string, Vec2> = {};
    for (const nodeId of nodeIds) {
      const node = state.scene.nodes[nodeId];
      ensureVelocityNode(node.id);
      previousPositions[node.id] = { x: node.pos.x, y: node.pos.y };
      if (fixedNodeIds.has(nodeId)) {
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
        continue;
      }
      node.pos.x += velocities[node.id].x * dt;
      node.pos.y += velocities[node.id].y * dt;
    }

    enforceComponentConstraints(
      state.scene,
      nodeIds,
      stickIds,
      fixedNodeIds,
      state.physicsOptions.constraintIterations
    );

    for (const nodeId of nodeIds) {
      const node = state.scene.nodes[nodeId];
      if (fixedNodeIds.has(nodeId)) {
        velocities[node.id].x = 0;
        velocities[node.id].y = 0;
        continue;
      }
      const previous = previousPositions[node.id];
      velocities[node.id].x = (node.pos.x - previous.x) / dt;
      velocities[node.id].y = (node.pos.y - previous.y) / dt;
    }

    const distanceConstraints = gatherDistanceConstraints();
    const lineConstraints = gatherLineConstraints();
    const attachmentConstraints = gatherAttachmentConstraints();
    updatePhysicsDiagnostics(distanceConstraints, lineConstraints, attachmentConstraints);
  };

  const pruneVelocities = (): void => {
    pruneAttachments();
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
    clearConstraintLambdas();
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
    setPenSelection(state, nodeId);
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

    detachAttachmentsForHostStick(stickId);
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

  const deletePenByNodeId = (nodeId: string): Result => {
    if (isEditLocked()) {
      return { ok: false, reason: 'Pen editing is disabled while physics is enabled.' };
    }

    if (!state.pens[nodeId]) {
      return { ok: false, reason: 'Pen does not exist.' };
    }

    removePenForNode(nodeId);
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
    detachNodeAttachment(nodeId);

    const incidentStickIds = Object.values(state.scene.sticks)
      .filter((stick) => stick.a === nodeId || stick.b === nodeId)
      .map((stick) => stick.id);

    for (const stickId of incidentStickIds) {
      const stick = state.scene.sticks[stickId];
      if (!stick) {
        continue;
      }
      detachAttachmentsForHostStick(stickId);
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
        visible: true
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

    updateDrag(pointer, options = {}): Result {
      const activeNodeId = state.drag.activeNodeId;
      if (!activeNodeId) {
        return { ok: false, reason: 'No active drag.' };
      }

      const activeNode = state.scene.nodes[activeNodeId];
      if (!activeNode) {
        return { ok: false, reason: 'Active node does not exist.' };
      }

      const disableSnap = options.disableSnap ?? false;
      const rawPointer = { x: pointer.x, y: pointer.y };
      const previousRawPointer = state.drag.rawPointer ?? { x: rawPointer.x, y: rawPointer.y };
      let constrainedPointer = { x: rawPointer.x, y: rawPointer.y };
      if (!activeNode.attachmentId && activeNode.lineConstraintId) {
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
      if (!disableSnap && !activeNode.attachmentId && !activeNode.lineConstraintId) {
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

    endStick(end, options = {}): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      const startNodeId = state.createStick.startNodeId;
      if (!startNodeId) {
        return { ok: false, reason: 'No active stick creation.' };
      }

      const disableSnap = options.disableSnap ?? false;
      const snappedEndNodeId = disableSnap ? null : hitTestPivot(state.scene.nodes, end, SNAP_RADIUS);
      let endNodeId: string;
      let endCreated = false;
      let endPendingInteriorSplit = false;

      if (snappedEndNodeId) {
        endNodeId = snappedEndNodeId;
      } else {
        const interiorHit = disableSnap ? null : findInteriorStickHit(state.scene, end, SNAP_RADIUS);
        if (interiorHit) {
          endNodeId = createNodeAt(interiorHit.projected);
          endCreated = true;
          endPendingInteriorSplit = true;
        } else {
          endNodeId = createNodeAt(end);
          endCreated = true;
        }
      }

      if (!disableSnap && !endPendingInteriorSplit) {
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
        visible: true
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
          attachNodeToHostStick(startTarget.stickId, startNodeId);
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
          attachNodeToHostStick(endTarget.stickId, endNodeId);
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
        if (state.selection.anchorNodeId || state.selection.penNodeId || state.selection.pivotNodeId) {
          clearAllSelections(state);
          emit();
        }
        return;
      }
      if (state.tool === 'stick') {
        const hadSelection =
          state.selection.stickId ||
          state.selection.anchorNodeId ||
          state.selection.penNodeId ||
          state.selection.pivotNodeId;
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
          state.selection.penNodeId ||
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
          state.selection.penNodeId ||
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
          state.selection.penNodeId ||
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

      const penNodeId = hitTestPenAtPoint(point, PEN_HIT_RADIUS);
      if (penNodeId) {
        const node = state.scene.nodes[penNodeId];
        if (node && !node.anchored) {
          setPenSelection(state, penNodeId);
          clearStickResize(state);
          clearLineResize(state);
          clearCircleResize(state);
          emit();
          return { kind: 'pen', id: penNodeId } as const;
        }
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
        state.selection.penNodeId ||
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
        state.selection.penNodeId ||
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
        if (state.selection.anchorNodeId || state.selection.penNodeId || state.selection.pivotNodeId) {
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

      if (
        state.selection.stickId ||
        state.selection.anchorNodeId ||
        state.selection.penNodeId ||
        state.selection.pivotNodeId ||
        state.stickResize.active
      ) {
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

      if (movingNode.attachmentId) {
        detachNodeAttachment(movingNode.id);
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
      for (const attachment of Object.values(state.scene.attachments)) {
        if (attachment.hostStickId === stick.id) {
          updateAttachmentNodePosition(attachment.id);
        }
      }
      ensureVelocityNode(movingNode.id);
      velocities[movingNode.id].x = 0;
      velocities[movingNode.id].y = 0;
      emit();
      return { ok: true };
    },

    endSelectedStickResize(options = {}): Result {
      if (isEditLocked()) {
        return { ok: false, reason: 'Stick editing is disabled while physics is enabled.' };
      }
      if (!state.stickResize.active) {
        return { ok: false, reason: 'No active stick resize.' };
      }

      const disableSnap = options.disableSnap ?? false;
      const stickId = state.stickResize.stickId;
      const movingNodeId = state.stickResize.movingNodeId;
      const fixedNodeId = state.stickResize.fixedNodeId;
      if (!disableSnap && stickId && movingNodeId && fixedNodeId) {
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
            attachNodeToHostStick(target.stickId, movingNodeId);
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
        if (
          state.selection.lineId ||
          state.selection.anchorNodeId ||
          state.selection.penNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.circleId ||
          state.lineResize.active
        ) {
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
          state.selection.penNodeId ||
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

    deleteSelectedPen(): Result {
      const penNodeId = state.selection.penNodeId;
      if (!penNodeId) {
        return { ok: false, reason: 'No selected pen.' };
      }
      return deletePenByNodeId(penNodeId);
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
        if (
          state.selection.circleId ||
          state.selection.anchorNodeId ||
          state.selection.penNodeId ||
          state.selection.pivotNodeId ||
          state.selection.stickId ||
          state.selection.lineId ||
          state.circleResize.active
        ) {
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
      const stickIds = Object.values(state.scene.sticks)
        .filter((stick) => stick.visible !== false)
        .map((stick) => stick.id);
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

    clearDrawing(): void {
      if (Object.keys(state.penTrails).length === 0) {
        return;
      }
      clearPenTrails();
      emit();
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
        const stickIds = Object.values(state.scene.sticks)
          .filter((stick) => stick.visible !== false)
          .map((stick) => stick.id);
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

    setPhysicsOptions(opts): void {
      const nextOptions: PhysicsOptions = { ...state.physicsOptions };
      let shouldClearLambdas = false;

      if (typeof opts.substeps === 'number') {
        nextOptions.substeps = clampInteger(opts.substeps, 1, PHYSICS_MAX_SUBSTEPS);
      }
      if (typeof opts.constraintIterations === 'number') {
        nextOptions.constraintIterations = clampInteger(
          opts.constraintIterations,
          1,
          PHYSICS_MAX_CONSTRAINT_ITERATIONS
        );
      }
      if (typeof opts.positionTolerance === 'number') {
        nextOptions.positionTolerance = clampPositive(
          opts.positionTolerance,
          state.physicsOptions.positionTolerance
        );
      }
      if (typeof opts.velocityTolerance === 'number') {
        nextOptions.velocityTolerance = clampPositive(
          opts.velocityTolerance,
          state.physicsOptions.velocityTolerance
        );
      }
      if (
        opts.integratorMode === 'legacy_projection' ||
        opts.integratorMode === 'rattle_symplectic'
      ) {
        shouldClearLambdas ||= nextOptions.integratorMode !== opts.integratorMode;
        nextOptions.integratorMode = opts.integratorMode;
      }
      if (opts.massModel === 'node_mass' || opts.massModel === 'rigid_stick') {
        nextOptions.massModel = opts.massModel;
      }
      if (opts.energyMode === 'strict' || opts.energyMode === 'bounded') {
        nextOptions.energyMode = opts.energyMode;
      }

      const changed =
        nextOptions.substeps !== state.physicsOptions.substeps ||
        nextOptions.constraintIterations !== state.physicsOptions.constraintIterations ||
        nextOptions.positionTolerance !== state.physicsOptions.positionTolerance ||
        nextOptions.velocityTolerance !== state.physicsOptions.velocityTolerance ||
        nextOptions.integratorMode !== state.physicsOptions.integratorMode ||
        nextOptions.massModel !== state.physicsOptions.massModel ||
        nextOptions.energyMode !== state.physicsOptions.energyMode;
      if (!changed) {
        return;
      }

      state.physicsOptions = nextOptions;
      if (shouldClearLambdas) {
        clearConstraintLambdas();
      }
      emit();
    },

    getPhysicsDiagnostics(): PhysicsDiagnostics {
      return {
        ...state.physicsDiagnostics,
        relativeJointAngleHistory: [...state.physicsDiagnostics.relativeJointAngleHistory]
      };
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

      const substeps = clampInteger(state.physicsOptions.substeps, 1, PHYSICS_MAX_SUBSTEPS);
      const integratorMode = state.physicsOptions.integratorMode;
      let remaining = Math.min(dtSeconds, 0.05);
      while (remaining > 1e-12) {
        const frameStep = Math.min(remaining, PHYSICS_MAX_STEP_SECONDS);
        remaining -= frameStep;
        const substepDt = frameStep / substeps;

        for (let i = 0; i < substeps; i += 1) {
          if (integratorMode === 'legacy_projection') {
            runLegacyProjectionSubstep(substepDt);
          } else {
            runRattleSymplecticSubstep(substepDt);
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
