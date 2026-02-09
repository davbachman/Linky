import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { DEFAULT_SNAP_RADIUS, hitTestPivot } from '../model/hitTest';
import { renderScene } from '../model/render';
import type {
  CreateStickState,
  CircleCreateState,
  LineCreateState,
  Scene,
  SceneStore,
  SelectionState,
  ToolMode,
  Vec2
} from '../model/types';

type LinkageCanvasProps = {
  store: SceneStore;
  scene: Scene;
  createStick: CreateStickState;
  createLine: LineCreateState;
  createCircle: CircleCreateState;
  selection: SelectionState;
  tool: ToolMode;
  renderNonce: number;
};

type InteractionMode =
  | 'stick'
  | 'drag'
  | 'resize-stick'
  | 'line'
  | 'resize-line'
  | 'circle'
  | 'resize-circle'
  | null;

function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

export function LinkageCanvas({
  store,
  scene,
  createStick,
  createLine,
  createCircle,
  selection,
  tool,
  renderNonce
}: LinkageCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeInteractionRef = useRef<InteractionMode>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 600 });

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || 900));
    const cssHeight = Math.max(1, Math.round(rect.height || 600));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    setViewport((prev) => {
      if (prev.width === cssWidth && prev.height === cssHeight) {
        return prev;
      }
      return {
        width: cssWidth,
        height: cssHeight
      };
    });
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [resizeCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    renderScene(
      ctx,
      viewport.width,
      viewport.height,
      scene,
      createStick,
      createLine,
      createCircle,
      selection
    );
  }, [
    scene,
    createStick,
    createLine,
    createCircle,
    selection,
    viewport.height,
    viewport.width,
    renderNonce
  ]);

  useEffect(() => {
    if (tool !== 'stick' && activeInteractionRef.current === 'stick') {
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'stick' && activeInteractionRef.current === 'resize-stick') {
      store.endSelectedStickResize();
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'line' && activeInteractionRef.current === 'line') {
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'line' && activeInteractionRef.current === 'resize-line') {
      store.endSelectedLineResize();
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'circle' && activeInteractionRef.current === 'circle') {
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'circle' && activeInteractionRef.current === 'resize-circle') {
      store.endSelectedCircleResize();
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'idle' && activeInteractionRef.current === 'drag') {
      store.endDrag();
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
  }, [store, tool]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const point = getCanvasPoint(event, canvas);

      if (tool === 'stick') {
        const resizeStart = store.tryBeginSelectedStickResizeAt(point);
        if (resizeStart.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'resize-stick';
          canvas.setPointerCapture(event.pointerId);
          return;
        }

        const pivotHit = hitTestPivot(scene.nodes, point, DEFAULT_SNAP_RADIUS);
        if (pivotHit) {
          store.clearSelectionForTool();
          const createFromPivot = store.beginStick(point);
          if (createFromPivot.ok) {
            activePointerIdRef.current = event.pointerId;
            activeInteractionRef.current = 'stick';
            canvas.setPointerCapture(event.pointerId);
          }
          return;
        }

        const selectResult = store.tryHandleStickToolClick(point);
        if (selectResult.ok) {
          return;
        }

        const result = store.beginStick(point);
        if (result.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'stick';
          canvas.setPointerCapture(event.pointerId);
        }
        return;
      }

      if (tool === 'anchor') {
        store.tryHandleAnchorToolClick(point);
        return;
      }

      if (tool === 'line') {
        const beginResize = store.tryBeginSelectedLineResizeAt(point);
        if (beginResize.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'resize-line';
          canvas.setPointerCapture(event.pointerId);
          return;
        }

        const selectLine = store.tryHandleLineToolClick(point);
        if (selectLine.ok) {
          return;
        }

        const beginLine = store.beginLine(point);
        if (beginLine.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'line';
          canvas.setPointerCapture(event.pointerId);
        }
        return;
      }

      if (tool === 'circle') {
        const beginResize = store.tryBeginSelectedCircleResizeAt(point);
        if (beginResize.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'resize-circle';
          canvas.setPointerCapture(event.pointerId);
          return;
        }

        const selectCircle = store.tryHandleCircleToolClick(point);
        if (selectCircle.ok) {
          return;
        }

        const beginCircle = store.beginCircle(point);
        if (beginCircle.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'circle';
          canvas.setPointerCapture(event.pointerId);
        }
        return;
      }

      const dragStart = store.tryBeginDragAt(point);
      if (dragStart.ok) {
        activePointerIdRef.current = event.pointerId;
        activeInteractionRef.current = 'drag';
        canvas.setPointerCapture(event.pointerId);
      }
    },
    [scene.nodes, store, tool]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const point = getCanvasPoint(event, canvas);

      if (activeInteractionRef.current === 'stick') {
        store.updateStickPreview(point);
      } else if (activeInteractionRef.current === 'resize-stick') {
        store.updateSelectedStickResize(point);
      } else if (activeInteractionRef.current === 'line') {
        store.updateLinePreview(point);
      } else if (activeInteractionRef.current === 'resize-line') {
        store.updateSelectedLineResize(point);
      } else if (activeInteractionRef.current === 'circle') {
        store.updateCirclePreview(point);
      } else if (activeInteractionRef.current === 'resize-circle') {
        store.updateSelectedCircleResize(point);
      } else if (activeInteractionRef.current === 'drag') {
        store.updateDrag(point);
      }
    },
    [store]
  );

  const finishInteraction = useMemo(
    () =>
      (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }

        const point = getCanvasPoint(event, canvas);

        if (activeInteractionRef.current === 'stick') {
          store.endStick(point);
        } else if (activeInteractionRef.current === 'resize-stick') {
          store.endSelectedStickResize();
        } else if (activeInteractionRef.current === 'line') {
          store.endLine(point);
        } else if (activeInteractionRef.current === 'resize-line') {
          store.endSelectedLineResize();
        } else if (activeInteractionRef.current === 'circle') {
          store.endCircle(point);
        } else if (activeInteractionRef.current === 'resize-circle') {
          store.endSelectedCircleResize();
        } else if (activeInteractionRef.current === 'drag') {
          store.endDrag();
        }

        canvas.releasePointerCapture(event.pointerId);
        activePointerIdRef.current = null;
        activeInteractionRef.current = null;
      },
    [store]
  );

  const cancelInteraction = useMemo(
    () =>
      (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }
        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }

        if (activeInteractionRef.current === 'drag') {
          store.endDrag();
        } else if (activeInteractionRef.current === 'resize-stick') {
          store.endSelectedStickResize();
        } else if (activeInteractionRef.current === 'resize-line') {
          store.endSelectedLineResize();
        } else if (activeInteractionRef.current === 'resize-circle') {
          store.endSelectedCircleResize();
        }

        canvas.releasePointerCapture(event.pointerId);
        activePointerIdRef.current = null;
        activeInteractionRef.current = null;
      },
    [store]
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="linkage-canvas"
      className="linkage-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={cancelInteraction}
    />
  );
}
