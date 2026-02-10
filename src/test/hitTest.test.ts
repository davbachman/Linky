import { describe, expect, it } from 'vitest';

import { hitTestPivot } from '../model/hitTest';
import type { Node } from '../model/types';

describe('hitTestPivot', () => {
  it('returns the nearest pivot within radius', () => {
    const nodes: Record<string, Node> = {
      'node-1': {
        id: 'node-1',
        pos: { x: 10, y: 10 },
        anchored: false,
        lineConstraintId: null,
        circleConstraintId: null,
        attachmentId: null
      },
      'node-2': {
        id: 'node-2',
        pos: { x: 30, y: 10 },
        anchored: false,
        lineConstraintId: null,
        circleConstraintId: null,
        attachmentId: null
      }
    };

    const hit = hitTestPivot(nodes, { x: 26, y: 12 }, 10);
    expect(hit).toBe('node-2');
  });

  it('returns null when no pivot is inside the radius', () => {
    const nodes: Record<string, Node> = {
      'node-1': {
        id: 'node-1',
        pos: { x: 10, y: 10 },
        anchored: false,
        lineConstraintId: null,
        circleConstraintId: null,
        attachmentId: null
      }
    };

    const hit = hitTestPivot(nodes, { x: 80, y: 80 }, 10);
    expect(hit).toBeNull();
  });
});
