import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from '../App';

type SceneDebugNode = {
  id: string;
  pos: { x: number; y: number };
  anchored: boolean;
  lineConstraintId: string | null;
  circleConstraintId: string | null;
};

type SceneDebug = {
  nodes: Record<string, SceneDebugNode>;
  sticks: Record<string, { id: string; a: string; b: string; restLength: number }>;
  lines: Record<string, { id: string; a: { x: number; y: number }; b: { x: number; y: number } }>;
  circles: Record<string, { id: string; center: { x: number; y: number }; radius: number }>;
};

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function parseScene(): SceneDebug {
  const value = screen.getByTestId('scene-debug').textContent;
  return JSON.parse(value || '{}') as SceneDebug;
}

function canvas(): HTMLCanvasElement {
  return screen.getByTestId('linkage-canvas') as HTMLCanvasElement;
}

function drawStick(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pointerId: number
): void {
  const target = canvas();
  fireEvent.pointerDown(target, { clientX: x1, clientY: y1, pointerId });
  fireEvent.pointerMove(target, { clientX: x2, clientY: y2, pointerId });
  fireEvent.pointerUp(target, { clientX: x2, clientY: y2, pointerId });
}

function drawLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pointerId: number
): void {
  const target = canvas();
  fireEvent.pointerDown(target, { clientX: x1, clientY: y1, pointerId });
  fireEvent.pointerMove(target, { clientX: x2, clientY: y2, pointerId });
  fireEvent.pointerUp(target, { clientX: x2, clientY: y2, pointerId });
}

function pressDelete(): void {
  fireEvent.keyDown(window, { key: 'Delete' });
}

describe('App integration', () => {
  it('creates a stick with click-drag-release in stick mode', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    expect(screen.getByTestId('node-count')).toHaveTextContent('2');
    expect(screen.getByTestId('stick-count')).toHaveTextContent('1');
  });

  it('snaps a second stick endpoint to an existing pivot and creates a shared hinge', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);
    drawStick(205, 104, 280, 170, 2);

    expect(screen.getByTestId('stick-count')).toHaveTextContent('2');
    expect(screen.getByTestId('node-count')).toHaveTextContent('3');
  });

  it('anchors an existing pivot and renders it as an anchor', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    fireEvent.click(screen.getByTestId('tool-anchor'));

    const target = canvas();
    const ctx = target.getContext('2d') as unknown as {
      __ops: Array<{ type: string; fillStyle?: string }>;
    };
    ctx.__ops.length = 0;

    fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 3 });

    expect(screen.getByTestId('anchor-count')).toHaveTextContent('1');
    expect(ctx.__ops.some((op) => op.type === 'fill' && op.fillStyle === '#d22')).toBe(true);
  });

  it('keeps anchors fixed for non-anchor drags and preserves rigidity on anchor drags', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    fireEvent.click(screen.getByTestId('tool-stick'));
    expect(screen.getByTestId('tool-mode')).toHaveTextContent('idle');

    const target = canvas();
    const beforeAnchor = parseScene();
    const anchorTarget = Object.values(beforeAnchor.nodes).find((node) => node.pos.x < 150);
    const freeNode = Object.values(beforeAnchor.nodes).find((node) => node.pos.x > 150);
    expect(anchorTarget).toBeDefined();
    expect(freeNode).toBeDefined();

    fireEvent.click(screen.getByTestId('tool-anchor'));
    fireEvent.pointerDown(target, {
      clientX: anchorTarget!.pos.x,
      clientY: anchorTarget!.pos.y,
      pointerId: 5
    });
    fireEvent.click(screen.getByTestId('tool-anchor'));

    const afterAnchorCreate = parseScene();
    const createdAnchor = afterAnchorCreate.nodes[anchorTarget!.id];
    expect(createdAnchor.anchored).toBe(true);

    fireEvent.pointerDown(target, {
      clientX: freeNode!.pos.x,
      clientY: freeNode!.pos.y,
      pointerId: 4
    });
    fireEvent.pointerMove(target, {
      clientX: freeNode!.pos.x + 40,
      clientY: freeNode!.pos.y + 20,
      pointerId: 4
    });
    fireEvent.pointerUp(target, {
      clientX: freeNode!.pos.x + 40,
      clientY: freeNode!.pos.y + 20,
      pointerId: 4
    });

    const afterNonAnchorDrag = parseScene();
    const movedNode = afterNonAnchorDrag.nodes[freeNode!.id];
    const fixedAnchor = afterNonAnchorDrag.nodes[anchorTarget!.id];
    const movedDistance = distance(movedNode.pos, freeNode!.pos);
    expect(movedDistance).toBeGreaterThan(0.1);
    expect(fixedAnchor.pos.x).toBeCloseTo(createdAnchor.pos.x, 6);
    expect(fixedAnchor.pos.y).toBeCloseTo(createdAnchor.pos.y, 6);

    const anchorStick = Object.values(afterNonAnchorDrag.sticks).find(
      (stick) => stick.a === anchorTarget!.id || stick.b === anchorTarget!.id
    );
    expect(anchorStick).toBeDefined();
    const freeStick = Object.values(afterNonAnchorDrag.sticks).find(
      (stick) => stick.a === freeNode!.id || stick.b === freeNode!.id
    );
    expect(freeStick).toBeDefined();
    const freeOtherId = freeStick!.a === freeNode!.id ? freeStick!.b : freeStick!.a;
    const freeOtherNode = afterNonAnchorDrag.nodes[freeOtherId];
    expect(distance(movedNode.pos, freeOtherNode.pos)).toBeCloseTo(freeStick!.restLength, 1);

    const beforeAnchorDrag = parseScene();
    const beforeOtherNodeId = anchorStick!.a === anchorTarget!.id ? anchorStick!.b : anchorStick!.a;
    const beforeOtherNode = beforeAnchorDrag.nodes[beforeOtherNodeId];

    fireEvent.pointerDown(target, {
      clientX: beforeAnchorDrag.nodes[anchorTarget!.id].pos.x,
      clientY: beforeAnchorDrag.nodes[anchorTarget!.id].pos.y,
      pointerId: 6
    });
    fireEvent.pointerMove(target, {
      clientX: beforeAnchorDrag.nodes[anchorTarget!.id].pos.x + 80,
      clientY: beforeAnchorDrag.nodes[anchorTarget!.id].pos.y + 80,
      pointerId: 6
    });
    fireEvent.pointerUp(target, {
      clientX: beforeAnchorDrag.nodes[anchorTarget!.id].pos.x + 80,
      clientY: beforeAnchorDrag.nodes[anchorTarget!.id].pos.y + 80,
      pointerId: 6
    });

    const afterAnchorDrag = parseScene();
    const anchoredNode = Object.values(afterAnchorDrag.nodes).find(
      (node) => node.id === anchorTarget!.id
    );
    const otherNode = afterAnchorDrag.nodes[beforeOtherNodeId];
    expect(anchoredNode?.anchored).toBe(true);
    expect(anchoredNode?.pos.x).not.toBeCloseTo(beforeAnchorDrag.nodes[anchorTarget!.id].pos.x, 4);
    expect(anchoredNode?.pos.y).not.toBeCloseTo(beforeAnchorDrag.nodes[anchorTarget!.id].pos.y, 4);
    expect(otherNode.pos.x).not.toBeCloseTo(beforeOtherNode.pos.x, 4);
    expect(otherNode.pos.y).not.toBeCloseTo(beforeOtherNode.pos.y, 4);
    expect(distance(anchoredNode!.pos, otherNode.pos)).toBeCloseTo(anchorStick!.restLength, 1);
  });

  it('enforces exclusive tool toggling', () => {
    render(<App />);

    const stickButton = screen.getByTestId('tool-stick');
    const anchorButton = screen.getByTestId('tool-anchor');

    fireEvent.click(stickButton);
    expect(stickButton).toHaveAttribute('aria-pressed', 'true');
    expect(anchorButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(anchorButton);
    expect(stickButton).toHaveAttribute('aria-pressed', 'false');
    expect(anchorButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(anchorButton);
    expect(stickButton).toHaveAttribute('aria-pressed', 'false');
    expect(anchorButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects/deletes anchors in anchor mode and clears selection on empty click', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    fireEvent.click(screen.getByTestId('tool-anchor'));
    const target = canvas();
    const ctx = target.getContext('2d') as unknown as {
      __ops: Array<{ type: string; strokeStyle?: string }>;
    };

    fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 2 });
    expect(screen.getByTestId('anchor-count')).toHaveTextContent('1');

    ctx.__ops.length = 0;
    fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 3 });
    expect(
      ctx.__ops.some((op) => op.type === 'stroke' && op.strokeStyle === 'rgba(255, 80, 80, 0.45)')
    ).toBe(true);

    pressDelete();
    expect(screen.getByTestId('anchor-count')).toHaveTextContent('0');

    fireEvent.pointerDown(target, { clientX: 100, clientY: 100, pointerId: 4 });
    expect(screen.getByTestId('anchor-count')).toHaveTextContent('1');
    fireEvent.pointerDown(target, { clientX: 500, clientY: 500, pointerId: 5 });
    pressDelete();
    expect(screen.getByTestId('anchor-count')).toHaveTextContent('1');
  });

  it('selects/deletes sticks in stick mode and clears selection on empty click', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 220, 100, 1);
    expect(screen.getByTestId('stick-count')).toHaveTextContent('1');

    const target = canvas();
    const ctx = target.getContext('2d') as unknown as {
      __ops: Array<{ type: string; strokeStyle?: string }>;
    };
    ctx.__ops.length = 0;

    fireEvent.pointerDown(target, { clientX: 160, clientY: 100, pointerId: 2 });
    expect(
      ctx.__ops.some((op) => op.type === 'stroke' && op.strokeStyle === 'rgba(30, 144, 255, 0.35)')
    ).toBe(true);

    fireEvent.pointerDown(target, { clientX: 500, clientY: 500, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 500, clientY: 500, pointerId: 3 });
    pressDelete();
    expect(screen.getByTestId('stick-count')).toHaveTextContent('1');

    fireEvent.pointerDown(target, { clientX: 160, clientY: 100, pointerId: 4 });
    pressDelete();
    expect(screen.getByTestId('stick-count')).toHaveTextContent('0');
  });

  it('resizes a selected stick by dragging one endpoint while the other stays fixed', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    const target = canvas();
    fireEvent.pointerDown(target, { clientX: 150, clientY: 100, pointerId: 2 });

    const before = parseScene();
    const stick = Object.values(before.sticks)[0];
    const aBefore = before.nodes[stick.a].pos;
    const bBefore = before.nodes[stick.b].pos;
    const movingNodeId = aBefore.x > bBefore.x ? stick.a : stick.b;
    const fixedNodeId = movingNodeId === stick.a ? stick.b : stick.a;
    const movingBefore = before.nodes[movingNodeId].pos;
    const fixedBefore = before.nodes[fixedNodeId].pos;

    fireEvent.pointerDown(target, {
      clientX: movingBefore.x,
      clientY: movingBefore.y,
      pointerId: 3
    });
    fireEvent.pointerMove(target, {
      clientX: movingBefore.x + 60,
      clientY: movingBefore.y + 30,
      pointerId: 3
    });
    fireEvent.pointerUp(target, {
      clientX: movingBefore.x + 60,
      clientY: movingBefore.y + 30,
      pointerId: 3
    });

    const after = parseScene();
    const afterStick = Object.values(after.sticks)[0];
    const movingAfter = after.nodes[movingNodeId].pos;
    const fixedAfter = after.nodes[fixedNodeId].pos;
    expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 6);
    expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 6);
    expect(movingAfter.x).not.toBeCloseTo(movingBefore.x, 4);
    expect(movingAfter.y).not.toBeCloseTo(movingBefore.y, 4);
    expect(afterStick.restLength).not.toBeCloseTo(stick.restLength, 4);
  });

  it('toggles play/stop physics buttons and disables edit tool buttons in play mode', () => {
    render(<App />);

    const playButton = screen.getByTestId('physics-play');
    const stopButton = screen.getByTestId('physics-stop');
    const stickButton = screen.getByTestId('tool-stick') as HTMLButtonElement;
    const anchorButton = screen.getByTestId('tool-anchor') as HTMLButtonElement;
    const lineButton = screen.getByTestId('tool-line') as HTMLButtonElement;
    const circleButton = screen.getByTestId('tool-circle') as HTMLButtonElement;

    expect(screen.getByTestId('physics-mode')).toHaveTextContent('stop');
    expect(stopButton).toHaveAttribute('aria-pressed', 'true');
    expect(stickButton.disabled).toBe(false);
    expect(anchorButton.disabled).toBe(false);
    expect(lineButton.disabled).toBe(false);
    expect(circleButton.disabled).toBe(false);

    fireEvent.click(playButton);
    expect(screen.getByTestId('physics-mode')).toHaveTextContent('play');
    expect(playButton).toHaveAttribute('aria-pressed', 'true');
    expect(stopButton).toHaveAttribute('aria-pressed', 'false');
    expect(stickButton.disabled).toBe(true);
    expect(anchorButton.disabled).toBe(true);
    expect(lineButton.disabled).toBe(true);
    expect(circleButton.disabled).toBe(true);

    fireEvent.click(stopButton);
    expect(screen.getByTestId('physics-mode')).toHaveTextContent('stop');
    expect(stopButton).toHaveAttribute('aria-pressed', 'true');
    expect(stickButton.disabled).toBe(false);
    expect(anchorButton.disabled).toBe(false);
    expect(lineButton.disabled).toBe(false);
    expect(circleButton.disabled).toBe(false);
  });

  it('allows dragging a free pivot to inject motion while physics is enabled', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 100, 200, 100, 1);

    fireEvent.click(screen.getByTestId('physics-play'));
    expect(screen.getByTestId('physics-mode')).toHaveTextContent('play');

    const target = canvas();
    const before = parseScene();
    const moving = Object.values(before.nodes).find((node) => !node.anchored && node.pos.x > 150);
    expect(moving).toBeDefined();

    fireEvent.pointerDown(target, { clientX: moving!.pos.x, clientY: moving!.pos.y, pointerId: 2 });
    fireEvent.pointerMove(target, {
      clientX: moving!.pos.x + 45,
      clientY: moving!.pos.y + 30,
      pointerId: 2
    });
    fireEvent.pointerUp(target, {
      clientX: moving!.pos.x + 45,
      clientY: moving!.pos.y + 30,
      pointerId: 2
    });

    const after = parseScene();
    const moved = after.nodes[moving!.id];
    expect(moved.pos.x).not.toBeCloseTo(moving!.pos.x, 2);
    expect(moved.pos.y).not.toBeCloseTo(moving!.pos.y, 2);
  });

  it('creates/selects/resizes/deletes lines in line mode', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-line'));
    drawLine(100, 120, 300, 120, 1);

    let scene = parseScene();
    expect(Object.keys(scene.lines)).toHaveLength(1);

    const target = canvas();
    const ctx = target.getContext('2d') as unknown as {
      __ops: Array<{ type: string; strokeStyle?: string }>;
    };
    ctx.__ops.length = 0;

    fireEvent.pointerDown(target, { clientX: 200, clientY: 120, pointerId: 2 });
    expect(
      ctx.__ops.some((op) => op.type === 'stroke' && op.strokeStyle === 'rgba(43, 108, 230, 0.35)')
    ).toBe(true);

    fireEvent.pointerDown(target, { clientX: 100, clientY: 120, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 70, clientY: 110, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 70, clientY: 110, pointerId: 3 });

    scene = parseScene();
    const line = Object.values(scene.lines)[0];
    expect(line).toBeDefined();
    expect(line.a.x).toBeCloseTo(70, 1);
    expect(line.a.y).toBeCloseTo(110, 1);

    fireEvent.pointerDown(target, { clientX: 500, clientY: 500, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 500, clientY: 500, pointerId: 4 });
    pressDelete();
    scene = parseScene();
    expect(Object.keys(scene.lines)).toHaveLength(1);

    fireEvent.pointerDown(target, { clientX: 180, clientY: 116, pointerId: 5 });
    pressDelete();
    scene = parseScene();
    expect(Object.keys(scene.lines)).toHaveLength(0);
  });

  it('keeps line-constrained pivots constrained under mostly tangential dragging', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 120, 220, 120, 1);

    fireEvent.click(screen.getByTestId('tool-line'));
    drawLine(150, 40, 150, 220, 2);
    fireEvent.click(screen.getByTestId('tool-line'));
    expect(screen.getByTestId('tool-mode')).toHaveTextContent('idle');

    const target = canvas();
    const before = parseScene();
    const moving = Object.values(before.nodes).find((node) => node.pos.x > 150);
    expect(moving).toBeDefined();

    fireEvent.pointerDown(target, { clientX: moving!.pos.x, clientY: moving!.pos.y, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 158, clientY: 165, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 158, clientY: 165, pointerId: 3 });

    const afterFirstDrag = parseScene();
    const constrained = afterFirstDrag.nodes[moving!.id];
    expect(constrained.lineConstraintId).toBeDefined();
    expect(constrained.pos.x).toBeCloseTo(150, 1);

    fireEvent.pointerDown(
      target,
      { clientX: afterFirstDrag.nodes[moving!.id].pos.x, clientY: afterFirstDrag.nodes[moving!.id].pos.y, pointerId: 4 }
    );
    fireEvent.pointerMove(target, { clientX: 154, clientY: 240, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 154, clientY: 240, pointerId: 4 });

    const afterSecondDrag = parseScene();
    expect(afterSecondDrag.nodes[moving!.id].pos.x).toBeCloseTo(150, 1);
  });

  it('releases line constraints when dragging mostly normal to the line', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(100, 120, 220, 120, 1);

    fireEvent.click(screen.getByTestId('tool-line'));
    drawLine(150, 40, 150, 220, 2);
    fireEvent.click(screen.getByTestId('tool-line'));

    const target = canvas();
    const before = parseScene();
    const moving = Object.values(before.nodes).find((node) => node.pos.x > 150);
    expect(moving).toBeDefined();

    fireEvent.pointerDown(target, { clientX: moving!.pos.x, clientY: moving!.pos.y, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 158, clientY: 165, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 158, clientY: 165, pointerId: 3 });
    expect(parseScene().nodes[moving!.id].lineConstraintId).toBeDefined();

    fireEvent.pointerDown(
      target,
      { clientX: parseScene().nodes[moving!.id].pos.x, clientY: parseScene().nodes[moving!.id].pos.y, pointerId: 4 }
    );
    fireEvent.pointerMove(target, { clientX: 235, clientY: 165, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 235, clientY: 165, pointerId: 4 });

    const after = parseScene().nodes[moving!.id];
    expect(after.lineConstraintId).toBeNull();
    expect(after.pos.x).toBeGreaterThan(170);
  });

  it('creates/selects/resizes/deletes circles in circle mode', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-circle'));
    drawLine(220, 220, 280, 220, 1);

    let scene = parseScene();
    expect(Object.keys(scene.circles)).toHaveLength(1);

    const target = canvas();
    const ctx = target.getContext('2d') as unknown as {
      __ops: Array<{ type: string; strokeStyle?: string }>;
    };
    ctx.__ops.length = 0;

    fireEvent.pointerDown(target, { clientX: 280, clientY: 220, pointerId: 2 });
    expect(
      ctx.__ops.some((op) => op.type === 'stroke' && op.strokeStyle === 'rgba(43, 108, 230, 0.35)')
    ).toBe(true);

    fireEvent.pointerDown(target, { clientX: 280, clientY: 220, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 310, clientY: 220, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 310, clientY: 220, pointerId: 3 });

    scene = parseScene();
    const circle = Object.values(scene.circles)[0];
    expect(circle.radius).toBeGreaterThan(70);

    fireEvent.pointerDown(target, { clientX: 500, clientY: 500, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 500, clientY: 500, pointerId: 4 });
    pressDelete();
    scene = parseScene();
    expect(Object.keys(scene.circles)).toHaveLength(1);

    fireEvent.pointerDown(target, { clientX: 300, clientY: 220, pointerId: 5 });
    pressDelete();
    scene = parseScene();
    expect(Object.keys(scene.circles)).toHaveLength(0);
  });

  it('keeps circle-constrained pivots constrained under mostly tangential dragging', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(260, 220, 360, 220, 1);

    fireEvent.click(screen.getByTestId('tool-circle'));
    drawLine(220, 220, 300, 220, 2);
    fireEvent.click(screen.getByTestId('tool-circle'));
    expect(screen.getByTestId('tool-mode')).toHaveTextContent('idle');

    const target = canvas();
    const before = parseScene();
    const moving = Object.values(before.nodes).find((node) => node.pos.x > 300);
    expect(moving).toBeDefined();

    fireEvent.pointerDown(target, { clientX: moving!.pos.x, clientY: moving!.pos.y, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 298, clientY: 222, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 298, clientY: 222, pointerId: 3 });

    const afterFirstDrag = parseScene();
    const constrained = afterFirstDrag.nodes[moving!.id];
    expect(constrained.circleConstraintId).toBeDefined();

    const circle = Object.values(afterFirstDrag.circles)[0];
    const firstRadiusError = Math.abs(distance(constrained.pos, circle.center) - circle.radius);
    expect(firstRadiusError).toBeLessThan(1.5);

    fireEvent.pointerDown(
      target,
      { clientX: afterFirstDrag.nodes[moving!.id].pos.x, clientY: afterFirstDrag.nodes[moving!.id].pos.y, pointerId: 4 }
    );
    fireEvent.pointerMove(target, { clientX: 302, clientY: 305, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 302, clientY: 305, pointerId: 4 });

    const afterSecondDrag = parseScene();
    const constrainedAgain = afterSecondDrag.nodes[moving!.id];
    const circleAfter = Object.values(afterSecondDrag.circles)[0];
    const secondRadiusError = Math.abs(
      distance(constrainedAgain.pos, circleAfter.center) - circleAfter.radius
    );
    expect(secondRadiusError).toBeLessThan(1.5);
  });

  it('releases circle constraints when dragging mostly normal to the circle', () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('tool-stick'));
    drawStick(260, 220, 360, 220, 1);

    fireEvent.click(screen.getByTestId('tool-circle'));
    drawLine(220, 220, 300, 220, 2);
    fireEvent.click(screen.getByTestId('tool-circle'));

    const target = canvas();
    const before = parseScene();
    const moving = Object.values(before.nodes).find((node) => node.pos.x > 300);
    expect(moving).toBeDefined();

    fireEvent.pointerDown(target, { clientX: moving!.pos.x, clientY: moving!.pos.y, pointerId: 3 });
    fireEvent.pointerMove(target, { clientX: 298, clientY: 222, pointerId: 3 });
    fireEvent.pointerUp(target, { clientX: 298, clientY: 222, pointerId: 3 });
    expect(parseScene().nodes[moving!.id].circleConstraintId).toBeDefined();

    fireEvent.pointerDown(
      target,
      { clientX: parseScene().nodes[moving!.id].pos.x, clientY: parseScene().nodes[moving!.id].pos.y, pointerId: 4 }
    );
    fireEvent.pointerMove(target, { clientX: 420, clientY: 220, pointerId: 4 });
    fireEvent.pointerUp(target, { clientX: 420, clientY: 220, pointerId: 4 });

    const afterScene = parseScene();
    const after = afterScene.nodes[moving!.id];
    const circle = Object.values(afterScene.circles)[0];
    const radiusError = Math.abs(distance(after.pos, circle.center) - circle.radius);
    expect(after.circleConstraintId).toBeNull();
    expect(radiusError).toBeGreaterThan(10);
  });
});
