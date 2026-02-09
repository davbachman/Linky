import { useEffect, useRef, useState } from 'react';

import { LinkageCanvas } from './canvas/LinkageCanvas';
import { createSceneStore } from './model/store';
import type { SceneStore } from './model/types';
import { Toolbar } from './ui/Toolbar';

type AppProps = {
  store?: SceneStore;
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
  if (!localStoreRef.current) {
    localStoreRef.current = createSceneStore();
  }

  const sceneStore = store ?? localStoreRef.current!;
  const version = useStoreVersion(sceneStore);
  const state = sceneStore.getState();

  const nodeCount = Object.keys(state.scene.nodes).length;
  const stickCount = Object.keys(state.scene.sticks).length;
  const anchorCount = Object.values(state.scene.nodes).filter((node) => node.anchored).length;

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

      if (state.selection.circleId) {
        event.preventDefault();
        sceneStore.deleteSelectedCircle();
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
    state.selection.pivotNodeId,
    state.selection.circleId,
    state.selection.lineId,
    state.selection.stickId
  ]);

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
          if (state.tool === mode) {
            sceneStore.setTool('idle');
          } else {
            sceneStore.setTool(mode);
          }
        }}
        onSetPhysicsEnabled={(enabled) => {
          sceneStore.setPhysicsEnabled(enabled);
        }}
      />

      <div className="canvas-wrap">
        <LinkageCanvas
          store={sceneStore}
          scene={state.scene}
          createStick={state.createStick}
          createLine={state.createLine}
          createCircle={state.createCircle}
          selection={state.selection}
          tool={state.tool}
          renderNonce={version}
        />
      </div>

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
    </div>
  );
}
