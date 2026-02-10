import type { Scene, SolverOptions, Vec2 } from './types';

export type ConnectedComponent = {
  nodeIds: string[];
  stickIds: string[];
  attachmentIds: string[];
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
    return { nodeIds: [], stickIds: [], attachmentIds: [] };
  }

  const stickAdjacency = new Map<string, string[]>();
  const attachmentAdjacency = new Map<string, string[]>();
  const ensureAdjacencyBuckets = (nodeId: string): void => {
    if (!stickAdjacency.has(nodeId)) {
      stickAdjacency.set(nodeId, []);
    }
    if (!attachmentAdjacency.has(nodeId)) {
      attachmentAdjacency.set(nodeId, []);
    }
  };

  for (const stick of Object.values(scene.sticks)) {
    if (stick.visible === false) {
      continue;
    }
    ensureAdjacencyBuckets(stick.a);
    ensureAdjacencyBuckets(stick.b);
    stickAdjacency.get(stick.a)?.push(stick.id);
    stickAdjacency.get(stick.b)?.push(stick.id);
  }

  for (const attachment of Object.values(scene.attachments)) {
    const attachedNode = scene.nodes[attachment.nodeId];
    const host = scene.sticks[attachment.hostStickId];
    if (!attachedNode || !host || host.visible === false) {
      continue;
    }
    ensureAdjacencyBuckets(attachment.nodeId);
    ensureAdjacencyBuckets(host.a);
    ensureAdjacencyBuckets(host.b);
    attachmentAdjacency.get(attachment.nodeId)?.push(attachment.id);
    attachmentAdjacency.get(host.a)?.push(attachment.id);
    attachmentAdjacency.get(host.b)?.push(attachment.id);
  }

  const queue: string[] = [startNodeId];
  const visitedNodes = new Set<string>([startNodeId]);
  const visitedSticks = new Set<string>();
  const visitedAttachments = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    for (const stickId of stickAdjacency.get(nodeId) ?? []) {
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

    for (const attachmentId of attachmentAdjacency.get(nodeId) ?? []) {
      if (visitedAttachments.has(attachmentId)) {
        continue;
      }
      visitedAttachments.add(attachmentId);
      const attachment = scene.attachments[attachmentId];
      const host = attachment ? scene.sticks[attachment.hostStickId] : null;
      if (!attachment || !host || host.visible === false) {
        continue;
      }
      const neighbors = [attachment.nodeId, host.a, host.b];
      for (const neighborId of neighbors) {
        if (!scene.nodes[neighborId]) {
          continue;
        }
        if (!visitedNodes.has(neighborId)) {
          visitedNodes.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
  }

  return {
    nodeIds: [...visitedNodes],
    stickIds: [...visitedSticks],
    attachmentIds: [...visitedAttachments]
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

  const applyAttachmentPositionConstraint = (attachmentId: string): number => {
    const attachment = scene.attachments[attachmentId];
    if (!attachment) {
      return 0;
    }
    const host = scene.sticks[attachment.hostStickId];
    if (!host || host.visible === false) {
      return 0;
    }
    const hostA = positions[host.a];
    const hostB = positions[host.b];
    const attached = positions[attachment.nodeId];
    if (!hostA || !hostB || !attached) {
      return 0;
    }

    const t = attachment.t;
    const oneMinusT = 1 - t;
    const aFixed = fixedNodes.has(host.a);
    const bFixed = fixedNodes.has(host.b);
    const hFixed = fixedNodes.has(attachment.nodeId);

    let maxAbsError = 0;
    const solveAxis = (axis: 'x' | 'y'): void => {
      const c = attached[axis] - (oneMinusT * hostA[axis] + t * hostB[axis]);
      maxAbsError = Math.max(maxAbsError, Math.abs(c));
      if (Math.abs(c) <= options.tolerancePx) {
        return;
      }

      const invA = aFixed ? 0 : 1;
      const invB = bFixed ? 0 : 1;
      const invH = hFixed ? 0 : 1;
      const denom = oneMinusT * oneMinusT * invA + t * t * invB + invH;
      if (denom <= EPSILON) {
        return;
      }

      const deltaLambda = -c / denom;
      if (!aFixed) {
        hostA[axis] += invA * (-oneMinusT) * deltaLambda;
      }
      if (!bFixed) {
        hostB[axis] += invB * (-t) * deltaLambda;
      }
      if (!hFixed) {
        attached[axis] += invH * deltaLambda;
      }
    };

    solveAxis('x');
    solveAxis('y');
    return maxAbsError;
  };

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

    for (const attachmentId of component.attachmentIds) {
      const attachmentError = applyAttachmentPositionConstraint(attachmentId);
      if (attachmentError > maxError) {
        maxError = attachmentError;
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

    for (const attachmentId of component.attachmentIds) {
      const attachment = scene.attachments[attachmentId];
      if (!attachment) {
        continue;
      }
      const host = scene.sticks[attachment.hostStickId];
      if (!host || host.visible === false) {
        continue;
      }

      const aDisp = displacements[host.a];
      const bDisp = displacements[host.b];
      const hDisp = displacements[attachment.nodeId];
      if (!aDisp || !bDisp || !hDisp) {
        continue;
      }

      const t = attachment.t;
      const oneMinusT = 1 - t;
      const aFixed = fixedNodeIds.has(host.a);
      const bFixed = fixedNodeIds.has(host.b);
      const hFixed = fixedNodeIds.has(attachment.nodeId);

      const solveAxis = (axis: 'x' | 'y'): void => {
        const violation = hDisp[axis] - (oneMinusT * aDisp[axis] + t * bDisp[axis]);
        if (Math.abs(violation) <= SUBSPACE_PROJECTION_EPSILON) {
          return;
        }

        const invA = aFixed ? 0 : 1;
        const invB = bFixed ? 0 : 1;
        const invH = hFixed ? 0 : 1;
        const denom = oneMinusT * oneMinusT * invA + t * t * invB + invH;
        if (denom <= SUBSPACE_PROJECTION_EPSILON) {
          return;
        }

        const deltaLambda = -violation / denom;
        if (!aFixed) {
          aDisp[axis] += invA * (-oneMinusT) * deltaLambda;
        }
        if (!bFixed) {
          bDisp[axis] += invB * (-t) * deltaLambda;
        }
        if (!hFixed) {
          hDisp[axis] += invH * deltaLambda;
        }
      };

      solveAxis('x');
      solveAxis('y');
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
