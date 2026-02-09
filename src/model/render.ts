import { distance } from './hitTest';
import type {
  CircleCreateState,
  CreateStickState,
  LineCreateState,
  Scene,
  SelectionState
} from './types';

export const BACKGROUND_COLOR = '#f8f8f6';
export const STICK_FILL_COLOR = '#D2B48C';
export const STICK_STROKE_COLOR = '#000';
export const PIVOT_COLOR = '#000';
export const ANCHOR_COLOR = '#d22';

export const STICK_WIDTH = 10;
export const STICK_OUTLINE_WIDTH = 2;
export const PIVOT_RADIUS = 3;
export const ANCHOR_RADIUS = 8;
const STICK_AURA_COLOR = 'rgba(30, 144, 255, 0.35)';
const ANCHOR_AURA_COLOR = 'rgba(255, 80, 80, 0.45)';
const LINE_COLOR = '#2b6ce6';
const LINE_AURA_COLOR = 'rgba(43, 108, 230, 0.35)';
const CIRCLE_COLOR = '#2b6ce6';
const CIRCLE_AURA_COLOR = 'rgba(43, 108, 230, 0.35)';

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: Scene,
  createStick: CreateStickState,
  createLine: LineCreateState,
  createCircle: CircleCreateState,
  selection: SelectionState
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  for (const stick of Object.values(scene.sticks)) {
    const a = scene.nodes[stick.a]?.pos;
    const b = scene.nodes[stick.b]?.pos;
    if (!a || !b) {
      continue;
    }

    const len = distance(a, b);
    if (len <= 0) {
      continue;
    }

    const angle = Math.atan2(b.y - a.y, b.x - a.x);

    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.rect(0, -STICK_WIDTH / 2, len, STICK_WIDTH);
    ctx.fillStyle = STICK_FILL_COLOR;
    ctx.strokeStyle = STICK_STROKE_COLOR;
    ctx.lineWidth = STICK_OUTLINE_WIDTH;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  for (const line of Object.values(scene.lines)) {
    ctx.beginPath();
    ctx.moveTo(line.a.x, line.a.y);
    ctx.lineTo(line.b.x, line.b.y);
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  for (const circle of Object.values(scene.circles)) {
    ctx.beginPath();
    ctx.arc(circle.center.x, circle.center.y, circle.radius, 0, Math.PI * 2);
    ctx.strokeStyle = CIRCLE_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (selection.lineId) {
    const line = scene.lines[selection.lineId];
    if (line) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(line.a.x, line.a.y);
      ctx.lineTo(line.b.x, line.b.y);
      ctx.strokeStyle = LINE_AURA_COLOR;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  if (selection.circleId) {
    const circle = scene.circles[selection.circleId];
    if (circle) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(circle.center.x, circle.center.y, circle.radius, 0, Math.PI * 2);
      ctx.strokeStyle = CIRCLE_AURA_COLOR;
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.restore();
    }
  }

  if (selection.stickId) {
    const selectedStick = scene.sticks[selection.stickId];
    if (selectedStick) {
      const a = scene.nodes[selectedStick.a]?.pos;
      const b = scene.nodes[selectedStick.b]?.pos;
      if (a && b) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = STICK_AURA_COLOR;
        ctx.lineWidth = STICK_WIDTH + 10;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  if (createStick.startNodeId && createStick.previewEnd) {
    const start = scene.nodes[createStick.startNodeId]?.pos;
    if (start) {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(createStick.previewEnd.x, createStick.previewEnd.y);
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  if (createLine.start && createLine.previewEnd) {
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.moveTo(createLine.start.x, createLine.start.y);
    ctx.lineTo(createLine.previewEnd.x, createLine.previewEnd.y);
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  if (createCircle.center && createCircle.previewEdge) {
    const radius = distance(createCircle.center, createCircle.previewEdge);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.arc(createCircle.center.x, createCircle.center.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = CIRCLE_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  for (const node of Object.values(scene.nodes)) {
    if (node.anchored) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(node.pos.x, node.pos.y, PIVOT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = PIVOT_COLOR;
    ctx.fill();
  }

  for (const node of Object.values(scene.nodes)) {
    if (!node.anchored) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(node.pos.x, node.pos.y, ANCHOR_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ANCHOR_COLOR;
    ctx.fill();
  }

  if (selection.anchorNodeId) {
    const selectedAnchor = scene.nodes[selection.anchorNodeId];
    if (selectedAnchor?.anchored) {
      ctx.beginPath();
      ctx.arc(selectedAnchor.pos.x, selectedAnchor.pos.y, ANCHOR_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = ANCHOR_AURA_COLOR;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
