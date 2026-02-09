import type { Scene, SolverOptions, Vec2 } from './types';

export type ConnectedComponent = {
  nodeIds: string[];
  stickIds: string[];
};

export type SolveResult = {
  positions: Record<string, Vec2>;
  converged: boolean;
  maxError: number;
};

export type DragConstraintMode = 'auto' | 'fixed' | 'soft';

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  iterations: 64,
  tolerancePx: 0.01
};

const EPSILON = 1e-6;
const DRAG_PULL_FACTOR = 0.35;
const SUBSPACE_PROJECTION_EPSILON = 1e-6;

export function getConnectedComponent(scene: Scene, startNodeId: string): ConnectedComponent {
  if (!scene.nodes[startNodeId]) {
    return { nodeIds: [], stickIds: [] };
  }

  const adjacency = new Map<string, string[]>();
  for (const stick of Object.values(scene.sticks)) {
    if (!adjacency.has(stick.a)) {
      adjacency.set(stick.a, []);
    }
    if (!adjacency.has(stick.b)) {
      adjacency.set(stick.b, []);
    }
    adjacency.get(stick.a)?.push(stick.id);
    adjacency.get(stick.b)?.push(stick.id);
  }

  const queue: string[] = [startNodeId];
  const visitedNodes = new Set<string>([startNodeId]);
  const visitedSticks = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    for (const stickId of adjacency.get(nodeId) ?? []) {
      if (visitedSticks.has(stickId)) {
        continue;
      }
      visitedSticks.add(stickId);

      const stick = scene.sticks[stickId];
      const otherNodeId = stick.a === nodeId ? stick.b : stick.a;
      if (!visitedNodes.has(otherNodeId)) {
        visitedNodes.add(otherNodeId);
        queue.push(otherNodeId);
      }
    }
  }

  return {
    nodeIds: [...visitedNodes],
    stickIds: [...visitedSticks]
  };
}

export function solveComponentPositions(
  scene: Scene,
  component: ConnectedComponent,
  draggedNodeId: string,
  dragTarget: Vec2,
  options: SolverOptions = DEFAULT_SOLVER_OPTIONS,
  dragMode: DragConstraintMode = 'auto'
): SolveResult {
  const positions: Record<string, Vec2> = {};
  for (const nodeId of component.nodeIds) {
    const node = scene.nodes[nodeId];
    positions[nodeId] = { x: node.pos.x, y: node.pos.y };
  }

  if (!positions[draggedNodeId]) {
    return { positions, converged: true, maxError: 0 };
  }

  const fixedNodes = new Set<string>();
  for (const nodeId of component.nodeIds) {
    const node = scene.nodes[nodeId];
    if (node.anchored && nodeId !== draggedNodeId) {
      fixedNodes.add(nodeId);
    }
  }

  const effectiveDragMode =
    dragMode === 'auto' ? (fixedNodes.size === 0 ? 'fixed' : 'soft') : dragMode;
  const draggedIsFixed = effectiveDragMode === 'fixed';
  if (draggedIsFixed) {
    fixedNodes.add(draggedNodeId);
  }

  let maxError = Number.POSITIVE_INFINITY;

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    if (draggedIsFixed) {
      positions[draggedNodeId].x = dragTarget.x;
      positions[draggedNodeId].y = dragTarget.y;
    } else {
      const dragged = positions[draggedNodeId];
      dragged.x += (dragTarget.x - dragged.x) * DRAG_PULL_FACTOR;
      dragged.y += (dragTarget.y - dragged.y) * DRAG_PULL_FACTOR;
    }

    maxError = 0;

    for (const stickId of component.stickIds) {
      const stick = scene.sticks[stickId];
      const aId = stick.a;
      const bId = stick.b;
      const aPos = positions[aId];
      const bPos = positions[bId];

      if (!aPos || !bPos) {
        continue;
      }

      let dx = bPos.x - aPos.x;
      let dy = bPos.y - aPos.y;
      let dist = Math.hypot(dx, dy);

      if (dist < EPSILON) {
        dx = 1;
        dy = 0;
        dist = 1;
      }

      const error = dist - stick.restLength;
      const absError = Math.abs(error);
      if (absError > maxError) {
        maxError = absError;
      }

      if (absError <= options.tolerancePx) {
        continue;
      }

      const correctionX = (error * dx) / dist;
      const correctionY = (error * dy) / dist;

      const aFixed = fixedNodes.has(aId);
      const bFixed = fixedNodes.has(bId);

      if (!aFixed && !bFixed) {
        aPos.x += correctionX * 0.5;
        aPos.y += correctionY * 0.5;
        bPos.x -= correctionX * 0.5;
        bPos.y -= correctionY * 0.5;
      } else if (aFixed && !bFixed) {
        bPos.x -= correctionX;
        bPos.y -= correctionY;
      } else if (!aFixed && bFixed) {
        aPos.x += correctionX;
        aPos.y += correctionY;
      }
    }

    if (maxError <= options.tolerancePx) {
      break;
    }
  }

  if (draggedIsFixed) {
    positions[draggedNodeId].x = dragTarget.x;
    positions[draggedNodeId].y = dragTarget.y;
  }

  return {
    positions,
    converged: maxError <= options.tolerancePx,
    maxError
  };
}

export function projectDragDeltaToConstraintSubspace(
  scene: Scene,
  component: ConnectedComponent,
  draggedNodeId: string,
  desiredDelta: Vec2,
  fixedNodeIds: Set<string>,
  iterations = 80
): Record<string, Vec2> {
  const displacements: Record<string, Vec2> = {};
  for (const nodeId of component.nodeIds) {
    displacements[nodeId] = { x: 0, y: 0 };
  }

  if (!displacements[draggedNodeId]) {
    return displacements;
  }

  displacements[draggedNodeId].x = desiredDelta.x;
  displacements[draggedNodeId].y = desiredDelta.y;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const stickId of component.stickIds) {
      const stick = scene.sticks[stickId];
      const aId = stick.a;
      const bId = stick.b;
      const aPos = scene.nodes[aId]?.pos;
      const bPos = scene.nodes[bId]?.pos;
      const aDisp = displacements[aId];
      const bDisp = displacements[bId];

      if (!aPos || !bPos || !aDisp || !bDisp) {
        continue;
      }

      const ex = bPos.x - aPos.x;
      const ey = bPos.y - aPos.y;
      const len = Math.hypot(ex, ey);
      if (len < EPSILON) {
        continue;
      }

      const nx = ex / len;
      const ny = ey / len;

      const violation = nx * (bDisp.x - aDisp.x) + ny * (bDisp.y - aDisp.y);
      if (Math.abs(violation) <= SUBSPACE_PROJECTION_EPSILON) {
        continue;
      }

      const aFixed = fixedNodeIds.has(aId);
      const bFixed = fixedNodeIds.has(bId);

      if (aFixed && bFixed) {
        continue;
      }

      if (!aFixed && !bFixed) {
        const correction = violation * 0.5;
        aDisp.x += nx * correction;
        aDisp.y += ny * correction;
        bDisp.x -= nx * correction;
        bDisp.y -= ny * correction;
      } else if (aFixed && !bFixed) {
        bDisp.x -= nx * violation;
        bDisp.y -= ny * violation;
      } else if (!aFixed && bFixed) {
        aDisp.x += nx * violation;
        aDisp.y += ny * violation;
      }
    }

    for (const fixedId of fixedNodeIds) {
      const fixedDisp = displacements[fixedId];
      if (!fixedDisp) {
        continue;
      }
      fixedDisp.x = 0;
      fixedDisp.y = 0;
    }
  }

  return displacements;
}
