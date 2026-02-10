import { describe, expect, it } from 'vitest';

import { distance } from '../model/hitTest';
import { getConnectedComponent, solveComponentPositions } from '../model/solver';
import type { Scene } from '../model/types';

function stickLength(scene: Scene, aId: string, bId: string): number {
  return distance(scene.nodes[aId].pos, scene.nodes[bId].pos);
}

describe('solveComponentPositions', () => {
  it('preserves stick lengths for an open chain', () => {
    const scene: Scene = {
      nodes: {
        n1: {
          id: 'n1',
          pos: { x: 0, y: 0 },
          anchored: true,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        },
        n2: {
          id: 'n2',
          pos: { x: 100, y: 0 },
          anchored: false,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        },
        n3: {
          id: 'n3',
          pos: { x: 200, y: 0 },
          anchored: false,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        }
      },
      sticks: {
        s1: { id: 's1', a: 'n1', b: 'n2', restLength: 100 },
        s2: { id: 's2', a: 'n2', b: 'n3', restLength: 100 }
      },
      attachments: {},
      lines: {},
      circles: {}
    };

    const component = getConnectedComponent(scene, 'n3');
    const solved = solveComponentPositions(scene, component, 'n3', { x: 150, y: 100 }, {
      iterations: 80,
      tolerancePx: 0.01
    });

    for (const nodeId of component.nodeIds) {
      scene.nodes[nodeId].pos = solved.positions[nodeId];
    }

    expect(stickLength(scene, 'n1', 'n2')).toBeCloseTo(100, 1);
    expect(stickLength(scene, 'n2', 'n3')).toBeCloseTo(100, 1);
    expect(scene.nodes.n1.pos.x).toBeCloseTo(0, 6);
    expect(scene.nodes.n1.pos.y).toBeCloseTo(0, 6);
  });

  it('preserves stick lengths for a closed loop with anchor and dragged node', () => {
    const scene: Scene = {
      nodes: {
        n1: {
          id: 'n1',
          pos: { x: 0, y: 0 },
          anchored: true,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        },
        n2: {
          id: 'n2',
          pos: { x: 100, y: 0 },
          anchored: false,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        },
        n3: {
          id: 'n3',
          pos: { x: 100, y: 100 },
          anchored: false,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        },
        n4: {
          id: 'n4',
          pos: { x: 0, y: 100 },
          anchored: false,
          lineConstraintId: null,
          circleConstraintId: null,
          attachmentId: null
        }
      },
      sticks: {
        s1: { id: 's1', a: 'n1', b: 'n2', restLength: 100 },
        s2: { id: 's2', a: 'n2', b: 'n3', restLength: 100 },
        s3: { id: 's3', a: 'n3', b: 'n4', restLength: 100 },
        s4: { id: 's4', a: 'n4', b: 'n1', restLength: 100 }
      },
      attachments: {},
      lines: {},
      circles: {}
    };

    const component = getConnectedComponent(scene, 'n3');
    const solved = solveComponentPositions(scene, component, 'n3', { x: 120, y: 120 }, {
      iterations: 120,
      tolerancePx: 0.01
    });

    for (const nodeId of component.nodeIds) {
      scene.nodes[nodeId].pos = solved.positions[nodeId];
    }

    expect(stickLength(scene, 'n1', 'n2')).toBeCloseTo(100, 1);
    expect(stickLength(scene, 'n2', 'n3')).toBeCloseTo(100, 1);
    expect(stickLength(scene, 'n3', 'n4')).toBeCloseTo(100, 1);
    expect(stickLength(scene, 'n4', 'n1')).toBeCloseTo(100, 1);
    expect(scene.nodes.n1.pos.x).toBeCloseTo(0, 6);
    expect(scene.nodes.n1.pos.y).toBeCloseTo(0, 6);
    expect(scene.nodes.n3.pos.x).not.toBeCloseTo(120, 3);
    expect(scene.nodes.n3.pos.y).not.toBeCloseTo(120, 3);
  });
});
