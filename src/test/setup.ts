import '@testing-library/jest-dom';

import { vi } from 'vitest';

class MockPointerEvent extends MouseEvent {
  public pointerId: number;

  public pointerType: string;

  public isPrimary: boolean;

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, params);
    this.pointerId = params.pointerId ?? 1;
    this.pointerType = params.pointerType ?? 'mouse';
    this.isPrimary = params.isPrimary ?? true;
  }
}

if (typeof window.PointerEvent === 'undefined') {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: MockPointerEvent
  });
}

type CanvasOp = {
  type: string;
  [key: string]: unknown;
};

class MockCanvasContext2D {
  public __ops: CanvasOp[] = [];

  public fillStyle: string | CanvasGradient | CanvasPattern = '#000';

  public strokeStyle: string | CanvasGradient | CanvasPattern = '#000';

  public lineWidth = 1;

  clearRect = (x: number, y: number, width: number, height: number): void => {
    this.__ops.push({ type: 'clearRect', x, y, width, height });
  };

  fillRect = (x: number, y: number, width: number, height: number): void => {
    this.__ops.push({ type: 'fillRect', x, y, width, height, fillStyle: this.fillStyle });
  };

  beginPath = (): void => {
    this.__ops.push({ type: 'beginPath' });
  };

  rect = (x: number, y: number, width: number, height: number): void => {
    this.__ops.push({ type: 'rect', x, y, width, height });
  };

  fill = (): void => {
    this.__ops.push({ type: 'fill', fillStyle: this.fillStyle });
  };

  stroke = (): void => {
    this.__ops.push({ type: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
  };

  arc = (x: number, y: number, radius: number, startAngle: number, endAngle: number): void => {
    this.__ops.push({ type: 'arc', x, y, radius, startAngle, endAngle });
  };

  moveTo = (x: number, y: number): void => {
    this.__ops.push({ type: 'moveTo', x, y });
  };

  lineTo = (x: number, y: number): void => {
    this.__ops.push({ type: 'lineTo', x, y });
  };

  setLineDash = (segments: number[]): void => {
    this.__ops.push({ type: 'setLineDash', segments: [...segments] });
  };

  save = (): void => {
    this.__ops.push({ type: 'save' });
  };

  restore = (): void => {
    this.__ops.push({ type: 'restore' });
  };

  translate = (x: number, y: number): void => {
    this.__ops.push({ type: 'translate', x, y });
  };

  rotate = (angle: number): void => {
    this.__ops.push({ type: 'rotate', angle });
  };

  setTransform = (a: number, b: number, c: number, d: number, e: number, f: number): void => {
    this.__ops.push({ type: 'setTransform', a, b, c, d, e, f });
  };
}

const contextStore = new WeakMap<HTMLCanvasElement, MockCanvasContext2D>();

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value(type: string): MockCanvasContext2D | null {
    if (type !== '2d') {
      return null;
    }

    let context = contextStore.get(this);
    if (!context) {
      context = new MockCanvasContext2D();
      contextStore.set(this, context);
    }
    return context;
  }
});

Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
  configurable: true,
  writable: true,
  value: vi.fn()
});

Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
  configurable: true,
  writable: true,
  value: vi.fn()
});

Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  writable: true,
  value() {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON() {
        return {};
      }
    };
  }
});
