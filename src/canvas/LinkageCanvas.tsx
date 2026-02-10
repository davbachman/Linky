import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent
} from 'react';

import { renderScene } from '../model/render';
import type {
  CreateStickState,
  LineCreateState,
  Pen,
  PenTrailStroke,
  Scene,
  SceneStore,
  SelectionState,
  ToolMode,
  Vec2
} from '../model/types';

type LinkageCanvasProps = {
  store: SceneStore;
  scene: Scene;
  pens: Record<string, Pen>;
  penTrails: Record<string, PenTrailStroke[]>;
  createStick: CreateStickState;
  createLine: LineCreateState;
  selection: SelectionState;
  tool: ToolMode;
  renderNonce: number;
  onPenContextMenu: (payload: { nodeId: string; clientX: number; clientY: number } | null) => void;
};

type CameraState = {
  zoom: number;
  pan: Vec2;
};

type InteractionMode = 'stick' | 'drag' | 'resize-stick' | 'line' | 'resize-line' | 'pan' | null;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.0015;

function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement): Vec2 {
  return getCanvasPointFromClient(event.clientX, event.clientY, canvas);
}

function getCanvasPointFromClient(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement
): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function screenToWorld(point: Vec2, camera: CameraState): Vec2 {
  return {
    x: (point.x - camera.pan.x) / camera.zoom,
    y: (point.y - camera.pan.y) / camera.zoom
  };
}

export function LinkageCanvas({
  store,
  scene,
  pens,
  penTrails,
  createStick,
  createLine,
  selection,
  tool,
  renderNonce,
  onPenContextMenu
}: LinkageCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeInteractionRef = useRef<InteractionMode>(null);
  const panDragStartRef = useRef<{ pointer: Vec2; pan: Vec2 } | null>(null);
  const spacePressedRef = useRef(false);
  const cameraRef = useRef<CameraState>({ zoom: 1, pan: { x: 0, y: 0 } });
  const [viewport, setViewport] = useState({ width: 900, height: 600 });
  const [camera, setCamera] = useState<CameraState>({ zoom: 1, pan: { x: 0, y: 0 } });

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
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        spacePressedRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        spacePressedRef.current = false;
      }
    };

    const handleWindowBlur = (): void => {
      spacePressedRef.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

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
      pens,
      penTrails,
      createStick,
      createLine,
      selection,
      camera
    );
  }, [
    scene,
    pens,
    penTrails,
    createStick,
    createLine,
    selection,
    camera,
    viewport.height,
    viewport.width,
    renderNonce
  ]);

  useEffect(() => {
    if (tool !== 'stick' && activeInteractionRef.current === 'stick') {
      activeInteractionRef.current = null;
      activePointerIdRef.current = null;
    }
    if (tool !== 'line' && activeInteractionRef.current === 'line') {
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

      const beginPanInteraction = (screenPoint: Vec2): void => {
        activePointerIdRef.current = event.pointerId;
        activeInteractionRef.current = 'pan';
        panDragStartRef.current = {
          pointer: screenPoint,
          pan: {
            x: cameraRef.current.pan.x,
            y: cameraRef.current.pan.y
          }
        };
        canvas.setPointerCapture(event.pointerId);
      };

      const screenPoint = getCanvasPoint(event, canvas);
      const panWithMiddleButton = event.button === 1;
      const panWithSpaceDrag = event.button === 0 && spacePressedRef.current;
      if (panWithMiddleButton || panWithSpaceDrag) {
        event.preventDefault();
        beginPanInteraction(screenPoint);
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const point = screenToWorld(screenPoint, cameraRef.current);

      const beginStickResize = store.tryBeginSelectedStickResizeAt(point);
      if (beginStickResize.ok) {
        activePointerIdRef.current = event.pointerId;
        activeInteractionRef.current = 'resize-stick';
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      const beginLineResize = store.tryBeginSelectedLineResizeAt(point);
      if (beginLineResize.ok) {
        activePointerIdRef.current = event.pointerId;
        activeInteractionRef.current = 'resize-line';
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      const selectionHit = store.selectAt(point);
      if (selectionHit) {
        if (tool === 'stick' && (selectionHit.kind === 'pivot' || selectionHit.kind === 'anchor')) {
          const beginStick = store.beginStick(point);
          if (beginStick.ok) {
            activePointerIdRef.current = event.pointerId;
            activeInteractionRef.current = 'stick';
            canvas.setPointerCapture(event.pointerId);
          }
          return;
        }

        if (tool === 'anchor' && selectionHit.kind === 'pivot') {
          store.setAnchor(selectionHit.id);
          return;
        }

        if (tool === 'pen' && selectionHit.kind === 'pivot') {
          store.setPen(selectionHit.id);
          return;
        }

        if (tool === 'idle' && (selectionHit.kind === 'pivot' || selectionHit.kind === 'anchor')) {
          const dragStart = store.beginDrag(selectionHit.id);
          if (dragStart.ok) {
            activePointerIdRef.current = event.pointerId;
            activeInteractionRef.current = 'drag';
            canvas.setPointerCapture(event.pointerId);
          }
        }
        return;
      }

      if (tool === 'stick') {
        const beginStick = store.beginStick(point);
        if (beginStick.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'stick';
          canvas.setPointerCapture(event.pointerId);
        }
        return;
      }

      if (tool === 'line') {
        const beginLine = store.beginLine(point);
        if (beginLine.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'line';
          canvas.setPointerCapture(event.pointerId);
        }
        return;
      }

      if (tool === 'idle') {
        const dragStart = store.tryBeginDragAt(point);
        if (dragStart.ok) {
          activePointerIdRef.current = event.pointerId;
          activeInteractionRef.current = 'drag';
          canvas.setPointerCapture(event.pointerId);
        } else {
          beginPanInteraction(screenPoint);
        }
      }
    },
    [store, tool]
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const screenPoint = getCanvasPointFromClient(event.clientX, event.clientY, canvas);
      const point = screenToWorld(screenPoint, cameraRef.current);
      const nodeId = store.hitTestPen(point);
      if (nodeId) {
        event.preventDefault();
        onPenContextMenu({
          nodeId,
          clientX: event.clientX,
          clientY: event.clientY
        });
        return;
      }
      onPenContextMenu(null);
    },
    [onPenContextMenu, store]
  );

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    event.preventDefault();

    const screenPoint = getCanvasPointFromClient(event.clientX, event.clientY, canvas);
    setCamera((previous) => {
      const zoomFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previous.zoom * zoomFactor));
      if (Math.abs(nextZoom - previous.zoom) < 1e-6) {
        return previous;
      }

      const worldAtCursor = screenToWorld(screenPoint, previous);
      return {
        zoom: nextZoom,
        pan: {
          x: screenPoint.x - worldAtCursor.x * nextZoom,
          y: screenPoint.y - worldAtCursor.y * nextZoom
        }
      };
    });
  }, []);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      const screenPoint = getCanvasPoint(event, canvas);
      if (activeInteractionRef.current === 'pan') {
        const panStart = panDragStartRef.current;
        if (panStart) {
          setCamera((previous) => ({
            zoom: previous.zoom,
            pan: {
              x: panStart.pan.x + (screenPoint.x - panStart.pointer.x),
              y: panStart.pan.y + (screenPoint.y - panStart.pointer.y)
            }
          }));
        }
        return;
      }

      const point = screenToWorld(screenPoint, cameraRef.current);

      if (activeInteractionRef.current === 'stick') {
        store.updateStickPreview(point);
      } else if (activeInteractionRef.current === 'resize-stick') {
        store.updateSelectedStickResize(point);
      } else if (activeInteractionRef.current === 'line') {
        store.updateLinePreview(point);
      } else if (activeInteractionRef.current === 'resize-line') {
        store.updateSelectedLineResize(point);
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

        const screenPoint = getCanvasPoint(event, canvas);
        const point = screenToWorld(screenPoint, cameraRef.current);

        if (activeInteractionRef.current === 'stick') {
          store.endStick(point);
        } else if (activeInteractionRef.current === 'resize-stick') {
          store.endSelectedStickResize();
        } else if (activeInteractionRef.current === 'line') {
          store.endLine(point);
        } else if (activeInteractionRef.current === 'resize-line') {
          store.endSelectedLineResize();
        } else if (activeInteractionRef.current === 'drag') {
          store.endDrag();
        } else if (activeInteractionRef.current === 'pan') {
          panDragStartRef.current = null;
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
        } else if (activeInteractionRef.current === 'pan') {
          panDragStartRef.current = null;
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
      onContextMenu={handleContextMenu}
      onWheel={handleWheel}
    />
  );
}
