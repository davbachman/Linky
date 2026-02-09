import type { ToolMode } from '../model/types';

type ToolbarProps = {
  tool: ToolMode;
  physicsEnabled: boolean;
  onToggle: (mode: 'stick' | 'anchor' | 'line' | 'circle') => void;
  onSetPhysicsEnabled: (enabled: boolean) => void;
};

export function Toolbar({
  tool,
  physicsEnabled,
  onToggle,
  onSetPhysicsEnabled
}: ToolbarProps): JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button
          type="button"
          data-testid="tool-stick"
          aria-pressed={tool === 'stick'}
          disabled={physicsEnabled}
          className={tool === 'stick' ? 'active' : ''}
          onClick={() => onToggle('stick')}
        >
          Stick
        </button>
        <button
          type="button"
          data-testid="tool-anchor"
          aria-pressed={tool === 'anchor'}
          disabled={physicsEnabled}
          className={tool === 'anchor' ? 'active' : ''}
          onClick={() => onToggle('anchor')}
        >
          Anchor
        </button>
        <button
          type="button"
          data-testid="tool-line"
          aria-pressed={tool === 'line'}
          disabled={physicsEnabled}
          className={tool === 'line' ? 'active' : ''}
          onClick={() => onToggle('line')}
        >
          Line
        </button>
        <button
          type="button"
          data-testid="tool-circle"
          aria-pressed={tool === 'circle'}
          disabled={physicsEnabled}
          className={tool === 'circle' ? 'active' : ''}
          onClick={() => onToggle('circle')}
        >
          Circle
        </button>
      </div>
      <div className="toolbar-right">
        <button
          type="button"
          data-testid="physics-play"
          aria-pressed={physicsEnabled}
          className={physicsEnabled ? 'active' : ''}
          onClick={() => onSetPhysicsEnabled(true)}
        >
          <span aria-hidden="true">▶</span> Play
        </button>
        <button
          type="button"
          data-testid="physics-stop"
          aria-pressed={!physicsEnabled}
          className={!physicsEnabled ? 'active' : ''}
          onClick={() => onSetPhysicsEnabled(false)}
        >
          <span aria-hidden="true">■</span> Stop
        </button>
      </div>
    </div>
  );
}
