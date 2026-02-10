import { useEffect, useRef, useState } from 'react';

import { LinkageCanvas } from './canvas/LinkageCanvas';
import { createSceneStore } from './model/store';
import type { SceneStore } from './model/types';
import { Toolbar } from './ui/Toolbar';

type AppProps = {
  store?: SceneStore;
};

type PenContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

function useStoreVersion(store: SceneStore): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    return store.subscribe(() => {
      setVersion((previous) => previous + 1);
    });
  }, [store]);

  return version;
}

export default function App({ store }: AppProps): JSX.Element {
  const localStoreRef = useRef<SceneStore | null>(null);
  const penMenuRef = useRef<HTMLDivElement | null>(null);
  if (!localStoreRef.current) {
    localStoreRef.current = createSceneStore();
  }

  const sceneStore = store ?? localStoreRef.current!;
  const version = useStoreVersion(sceneStore);
  const [penMenu, setPenMenu] = useState<PenContextMenuState | null>(null);
  const state = sceneStore.getState();

  const nodeCount = Object.keys(state.scene.nodes).length;
  const stickCount = Object.values(state.scene.sticks).filter((stick) => stick.visible !== false).length;
  const anchorCount = Object.values(state.scene.nodes).filter((node) => node.anchored).length;
  const selectedPen = penMenu ? state.pens[penMenu.nodeId] : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (state.physics.enabled) {
        return;
      }

      if (state.selection.anchorNodeId) {
        event.preventDefault();
        sceneStore.deleteSelectedAnchor();
        return;
      }

      if (state.selection.penNodeId) {
        event.preventDefault();
        sceneStore.deleteSelectedPen();
        return;
      }

      if (state.selection.pivotNodeId) {
        event.preventDefault();
        sceneStore.deleteSelectedPivot();
        return;
      }

      if (state.selection.stickId) {
        event.preventDefault();
        sceneStore.deleteSelectedStick();
        return;
      }

      if (state.selection.lineId) {
        event.preventDefault();
        sceneStore.deleteSelectedLine();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    sceneStore,
    state.physics.enabled,
    state.selection.anchorNodeId,
    state.selection.penNodeId,
    state.selection.pivotNodeId,
    state.selection.lineId,
    state.selection.stickId
  ]);

  useEffect(() => {
    if (!penMenu) {
      return;
    }
    if (!state.pens[penMenu.nodeId] || !state.scene.nodes[penMenu.nodeId]) {
      setPenMenu(null);
    }
  }, [penMenu, state.pens, state.scene.nodes]);

  useEffect(() => {
    if (!penMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) {
        setPenMenu(null);
        return;
      }
      if (penMenuRef.current?.contains(target)) {
        return;
      }
      setPenMenu(null);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPenMenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [penMenu]);

  useEffect(() => {
    if (!state.physics.enabled) {
      return;
    }

    let frameId = 0;
    let lastTime = performance.now();

    const step = (now: number): void => {
      const dtSeconds = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      sceneStore.stepPhysics(dtSeconds);
      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [sceneStore, state.physics.enabled]);

  return (
    <div className="app-shell">
      <Toolbar
        tool={state.tool}
        physicsEnabled={state.physics.enabled}
        onToggle={(mode) => {
          setPenMenu(null);
          if (state.tool === mode) {
            sceneStore.setTool('idle');
          } else {
            sceneStore.setTool(mode);
          }
        }}
        onSetPhysicsEnabled={(enabled) => {
          setPenMenu(null);
          sceneStore.setPhysicsEnabled(enabled);
        }}
      />

      <div className="canvas-wrap">
        <LinkageCanvas
          store={sceneStore}
          scene={state.scene}
          pens={state.pens}
          penTrails={state.penTrails}
          createStick={state.createStick}
          createLine={state.createLine}
          selection={state.selection}
          tool={state.tool}
          renderNonce={version}
          onPenContextMenu={(payload) => {
            if (!payload) {
              setPenMenu(null);
              return;
            }
            setPenMenu({
              nodeId: payload.nodeId,
              x: payload.clientX,
              y: payload.clientY
            });
          }}
        />
      </div>

      {penMenu && selectedPen ? (
        <div
          ref={penMenuRef}
          data-testid="pen-context-menu"
          className="pen-context-menu"
          style={{
            left: `${Math.max(8, Math.min(penMenu.x, window.innerWidth - 210))}px`,
            top: `${Math.max(8, Math.min(penMenu.y, window.innerHeight - 130))}px`
          }}
        >
          <label className="pen-context-row" htmlFor="pen-color-input">
            Color
            <input
              id="pen-color-input"
              data-testid="pen-color-input"
              type="color"
              value={selectedPen.color}
              onChange={(event) => {
                sceneStore.setPenColor(penMenu.nodeId, event.target.value);
              }}
            />
          </label>
          <button
            type="button"
            data-testid="pen-enable-toggle"
            onClick={() => {
              sceneStore.setPenEnabled(penMenu.nodeId, !selectedPen.enabled);
              setPenMenu(null);
            }}
          >
            {selectedPen.enabled ? 'Disable pen' : 'Enable pen'}
          </button>
        </div>
      ) : null}

      <div className="statusbar" data-testid="statusbar">
        <span>
          Nodes: <strong data-testid="node-count">{nodeCount}</strong>
        </span>
        <span>
          Sticks: <strong data-testid="stick-count">{stickCount}</strong>
        </span>
        <span>
          Anchors: <strong data-testid="anchor-count">{anchorCount}</strong>
        </span>
        <span>
          Mode: <strong data-testid="tool-mode">{state.tool}</strong>
        </span>
        <span>
          Physics: <strong data-testid="physics-mode">{state.physics.enabled ? 'play' : 'stop'}</strong>
        </span>
      </div>

      <pre data-testid="scene-debug" className="scene-debug">
        {JSON.stringify(state.scene)}
      </pre>
      <pre data-testid="pen-debug" className="scene-debug">
        {JSON.stringify({ pens: state.pens, penTrails: state.penTrails })}
      </pre>
      <pre data-testid="physics-debug" className="scene-debug">
        {JSON.stringify(state.physicsDiagnostics)}
      </pre>
    </div>
  );
}
