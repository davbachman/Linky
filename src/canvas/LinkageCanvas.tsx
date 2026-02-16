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
type PinchGesture = {
  pointerA: number;
  pointerB: number;
  initialDistance: number;
  initialZoom: number;
  worldAtCenter: Vec2;
};

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

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5
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
  const touchPointsRef = useRef<Map<number, Vec2>>(new Map());
  const pinchGestureRef = useRef<PinchGesture | null>(null);
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
      touchPointsRef.current.clear();
      pinchGestureRef.current = null;
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

  const updatePinchCamera = useCallback((gesture: PinchGesture): boolean => {
    const pointA = touchPointsRef.current.get(gesture.pointerA);
    const pointB = touchPointsRef.current.get(gesture.pointerB);
    if (!pointA || !pointB) {
      return false;
    }

    const center = midpoint(pointA, pointB);
    const pinchDistance = Math.max(1, distanceBetween(pointA, pointB));
    const zoomScale = pinchDistance / gesture.initialDistance;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.initialZoom * zoomScale));
    const nextPanX = center.x - gesture.worldAtCenter.x * nextZoom;
    const nextPanY = center.y - gesture.worldAtCenter.y * nextZoom;

    setCamera((previous) => {
      if (
        Math.abs(previous.zoom - nextZoom) < 1e-6 &&
        Math.abs(previous.pan.x - nextPanX) < 1e-6 &&
        Math.abs(previous.pan.y - nextPanY) < 1e-6
      ) {
        return previous;
      }
      return {
        zoom: nextZoom,
        pan: {
          x: nextPanX,
          y: nextPanY
        }
      };
    });
    return true;
  }, []);

  const beginPinchInteraction = useCallback(
    (canvas: HTMLCanvasElement): void => {
      if (touchPointsRef.current.size < 2) {
        return;
      }
      if (activeInteractionRef.current && activeInteractionRef.current !== 'pan') {
        return;
      }

      const touches = Array.from(touchPointsRef.current.entries());
      const [firstTouch, secondTouch] = touches;
      if (!firstTouch || !secondTouch) {
        return;
      }

      if (activeInteractionRef.current === 'pan' && activePointerIdRef.current !== null) {
        try {
          canvas.releasePointerCapture(activePointerIdRef.current);
        } catch {
          // Ignore release failures if the pointer is no longer captured.
        }
      }

      activePointerIdRef.current = null;
      activeInteractionRef.current = null;
      panDragStartRef.current = null;

      const [pointerA, pointA] = firstTouch;
      const [pointerB, pointB] = secondTouch;
      const center = midpoint(pointA, pointB);
      const cameraNow = cameraRef.current;
      pinchGestureRef.current = {
        pointerA,
        pointerB,
        initialDistance: Math.max(1, distanceBetween(pointA, pointB)),
        initialZoom: cameraNow.zoom,
        worldAtCenter: screenToWorld(center, cameraNow)
      };
      updatePinchCamera(pinchGestureRef.current);
    },
    [updatePinchCamera]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const screenPoint = getCanvasPoint(event, canvas);

      if (event.pointerType === 'touch') {
        touchPointsRef.current.set(event.pointerId, screenPoint);
        if (touchPointsRef.current.size >= 2) {
          event.preventDefault();
          beginPinchInteraction(canvas);
          if (pinchGestureRef.current) {
            return;
          }
        }
      }

      if (
        event.pointerType === 'touch' &&
        activePointerIdRef.current !== null &&
        activePointerIdRef.current !== event.pointerId
      ) {
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
        if (
          tool === 'stick' &&
          (selectionHit.kind === 'pivot' || selectionHit.kind === 'pen' || selectionHit.kind === 'anchor')
        ) {
          const beginStick = store.beginStick(point);
          if (beginStick.ok) {
            activePointerIdRef.current = event.pointerId;
            activeInteractionRef.current = 'stick';
            canvas.setPointerCapture(event.pointerId);
          }
          return;
        }

        if (tool === 'anchor' && (selectionHit.kind === 'pivot' || selectionHit.kind === 'pen')) {
          store.setAnchor(selectionHit.id);
          return;
        }

        if (tool === 'pen' && (selectionHit.kind === 'pivot' || selectionHit.kind === 'pen')) {
          store.setPen(selectionHit.id);
          return;
        }

        if (
          tool === 'idle' &&
          (selectionHit.kind === 'pivot' || selectionHit.kind === 'pen' || selectionHit.kind === 'anchor')
        ) {
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
    [beginPinchInteraction, store, tool]
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

      const screenPoint = getCanvasPoint(event, canvas);

      if (event.pointerType === 'touch') {
        if (touchPointsRef.current.has(event.pointerId)) {
          touchPointsRef.current.set(event.pointerId, screenPoint);
        }
        const pinchGesture = pinchGestureRef.current;
        if (pinchGesture) {
          event.preventDefault();
          updatePinchCamera(pinchGesture);
          return;
        }
      }

      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

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
        store.updateDrag(point, { disableSnap: event.shiftKey });
      }
    },
    [store, updatePinchCamera]
  );

  const finishInteraction = useMemo(
    () =>
      (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          return;
        }

        if (event.pointerType === 'touch') {
          touchPointsRef.current.delete(event.pointerId);
          const pinchGesture = pinchGestureRef.current;
          if (pinchGesture) {
            const isPinchPointer =
              event.pointerId === pinchGesture.pointerA || event.pointerId === pinchGesture.pointerB;
            const hasBothPointers =
              touchPointsRef.current.has(pinchGesture.pointerA) &&
              touchPointsRef.current.has(pinchGesture.pointerB);
            if (!hasBothPointers) {
              pinchGestureRef.current = null;
            }
            if (isPinchPointer) {
              return;
            }
          }
        }

        if (activePointerIdRef.current !== event.pointerId) {
          return;
        }

        const screenPoint = getCanvasPoint(event, canvas);
        const point = screenToWorld(screenPoint, cameraRef.current);

        if (activeInteractionRef.current === 'stick') {
          store.endStick(point, { disableSnap: event.shiftKey });
        } else if (activeInteractionRef.current === 'resize-stick') {
          store.endSelectedStickResize({ disableSnap: event.shiftKey });
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

        if (event.pointerType === 'touch') {
          touchPointsRef.current.delete(event.pointerId);
          const pinchGesture = pinchGestureRef.current;
          if (pinchGesture) {
            const isPinchPointer =
              event.pointerId === pinchGesture.pointerA || event.pointerId === pinchGesture.pointerB;
            const hasBothPointers =
              touchPointsRef.current.has(pinchGesture.pointerA) &&
              touchPointsRef.current.has(pinchGesture.pointerB);
            if (!hasBothPointers) {
              pinchGestureRef.current = null;
            }
            if (isPinchPointer) {
              return;
            }
          }
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
