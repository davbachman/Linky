import type { Node, Scene, Vec2 } from './types';

export const DEFAULT_PIVOT_HIT_RADIUS = 10;
export const DEFAULT_SNAP_RADIUS = 12;
export const DEFAULT_STICK_HIT_RADIUS = 10;
export const DEFAULT_LINE_HIT_RADIUS = 10;
export const DEFAULT_LINE_ENDPOINT_HIT_RADIUS = 12;
export const DEFAULT_CIRCLE_HIT_RADIUS = 10;
export const DEFAULT_CIRCLE_HANDLE_HIT_RADIUS = 12;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function hitTestPivot(
  nodes: Record<string, Node>,
  point: Vec2,
  radius = DEFAULT_PIVOT_HIT_RADIUS
): string | null {
  const limit = radius * radius;
  let bestNodeId: string | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const node of Object.values(nodes)) {
    const d2 = distanceSq(node.pos, point);
    if (d2 > limit) {
      continue;
    }

    if (d2 < bestDistanceSq) {
      bestDistanceSq = d2;
      bestNodeId = node.id;
      continue;
    }

    if (d2 === bestDistanceSq && bestNodeId !== null && node.id < bestNodeId) {
      bestNodeId = node.id;
    }
  }

  return bestNodeId;
}

export function distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;

  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    return Math.hypot(point.x - b.x, point.y - b.y);
  }

  const t = c1 / c2;
  const projX = a.x + t * vx;
  const projY = a.y + t * vy;
  return Math.hypot(point.x - projX, point.y - projY);
}

export function hitTestStick(
  scene: Scene,
  point: Vec2,
  radius = DEFAULT_STICK_HIT_RADIUS
): string | null {
  let bestStickId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const stick of Object.values(scene.sticks)) {
    if (stick.visible === false) {
      continue;
    }
    const a = scene.nodes[stick.a]?.pos;
    const b = scene.nodes[stick.b]?.pos;
    if (!a || !b) {
      continue;
    }

    const d = distancePointToSegment(point, a, b);
    if (d > radius) {
      continue;
    }

    if (d < bestDistance) {
      bestDistance = d;
      bestStickId = stick.id;
    }
  }

  return bestStickId;
}

export function projectPointToInfiniteLine(point: Vec2, a: Vec2, b: Vec2): Vec2 {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-9) {
    return { x: a.x, y: a.y };
  }

  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const t = (wx * vx + wy * vy) / lenSq;
  return {
    x: a.x + t * vx,
    y: a.y + t * vy
  };
}

export function hitTestLine(
  scene: Scene,
  point: Vec2,
  radius = DEFAULT_LINE_HIT_RADIUS
): string | null {
  let bestLineId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const line of Object.values(scene.lines)) {
    const d = distancePointToSegment(point, line.a, line.b);
    if (d > radius) {
      continue;
    }
    if (d < bestDistance) {
      bestDistance = d;
      bestLineId = line.id;
    }
  }

  return bestLineId;
}

export function hitTestLineEndpoint(
  scene: Scene,
  lineId: string,
  point: Vec2,
  radius = DEFAULT_LINE_ENDPOINT_HIT_RADIUS
): 'a' | 'b' | null {
  const line = scene.lines[lineId];
  if (!line) {
    return null;
  }

  const da = distance(point, line.a);
  const db = distance(point, line.b);
  if (da > radius && db > radius) {
    return null;
  }
  return da <= db ? 'a' : 'b';
}

export function distancePointToCircle(point: Vec2, center: Vec2, radius: number): number {
  const d = distance(point, center);
  return Math.abs(d - radius);
}

export function projectPointToCircle(point: Vec2, center: Vec2, radius: number): Vec2 {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9) {
    return { x: center.x + radius, y: center.y };
  }
  const scale = radius / len;
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale
  };
}

export function hitTestCircle(
  scene: Scene,
  point: Vec2,
  radius = DEFAULT_CIRCLE_HIT_RADIUS
): string | null {
  let bestCircleId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const circle of Object.values(scene.circles)) {
    const d = distancePointToCircle(point, circle.center, circle.radius);
    if (d > radius) {
      continue;
    }
    if (d < bestDistance) {
      bestDistance = d;
      bestCircleId = circle.id;
    }
  }

  return bestCircleId;
}

export function hitTestCircleCenter(
  scene: Scene,
  circleId: string,
  point: Vec2,
  radius = DEFAULT_CIRCLE_HANDLE_HIT_RADIUS
): boolean {
  const circle = scene.circles[circleId];
  if (!circle) {
    return false;
  }
  return distance(point, circle.center) <= radius;
}

export function hitTestCircleRadiusHandle(
  scene: Scene,
  circleId: string,
  point: Vec2,
  radius = DEFAULT_CIRCLE_HANDLE_HIT_RADIUS
): boolean {
  const circle = scene.circles[circleId];
  if (!circle) {
    return false;
  }
  return distancePointToCircle(point, circle.center, circle.radius) <= radius;
}
