export type ToolMode = 'idle' | 'stick' | 'anchor' | 'line' | 'pen' | 'circle';

export type Vec2 = {
  x: number;
  y: number;
};

export type Node = {
  id: string;
  pos: Vec2;
  anchored: boolean;
  lineConstraintId: string | null;
  circleConstraintId: string | null;
  attachmentId: string | null;
};

export type Stick = {
  id: string;
  a: string;
  b: string;
  restLength: number;
  visible?: boolean;
};

export type AttachmentConstraint = {
  id: string;
  nodeId: string;
  hostStickId: string;
  t: number;
};

export type LineConstraint = {
  id: string;
  a: Vec2;
  b: Vec2;
};

export type CircleConstraint = {
  id: string;
  center: Vec2;
  radius: number;
};

export type Scene = {
  nodes: Record<string, Node>;
  sticks: Record<string, Stick>;
  attachments: Record<string, AttachmentConstraint>;
  lines: Record<string, LineConstraint>;
  circles: Record<string, CircleConstraint>;
};

export type Pen = {
  nodeId: string;
  color: string;
  enabled: boolean;
};

export type PenTrailStroke = {
  color: string;
  points: Vec2[];
};

export type DragState = {
  activeNodeId: string | null;
  pointer: Vec2 | null;
  rawPointer: Vec2 | null;
};

export type SelectionState = {
  anchorNodeId: string | null;
  penNodeId: string | null;
  pivotNodeId: string | null;
  stickId: string | null;
  lineId: string | null;
  circleId: string | null;
};

export type SelectionHit =
  | { kind: 'anchor'; id: string }
  | { kind: 'pen'; id: string }
  | { kind: 'pivot'; id: string }
  | { kind: 'stick'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'circle'; id: string };

export type StickResizeState = {
  active: boolean;
  stickId: string | null;
  fixedNodeId: string | null;
  movingNodeId: string | null;
};

export type LineCreateState = {
  start: Vec2 | null;
  previewEnd: Vec2 | null;
};

export type LineResizeState = {
  active: boolean;
  lineId: string | null;
  endpoint: 'a' | 'b' | null;
};

export type CircleCreateState = {
  center: Vec2 | null;
  previewEdge: Vec2 | null;
};

export type CircleResizeState = {
  active: boolean;
  circleId: string | null;
  mode: 'center' | 'radius' | null;
};

export type CreateStickState = {
  startNodeId: string | null;
  previewEnd: Vec2 | null;
};

export type SolverOptions = {
  iterations: number;
  tolerancePx: number;
};

export type PhysicsIntegratorMode = 'legacy_projection' | 'rattle_symplectic';

export type MassModel = 'node_mass' | 'rigid_stick';
export type PhysicsEnergyMode = 'strict' | 'bounded';

export type PhysicsOptions = {
  substeps: number;
  constraintIterations: number;
  positionTolerance: number;
  velocityTolerance: number;
  integratorMode: PhysicsIntegratorMode;
  massModel: MassModel;
  energyMode: PhysicsEnergyMode;
};

export type PhysicsDiagnostics = {
  totalKineticEnergy: number;
  angularMomentumAboutAnchor: number;
  constraintViolationL2: number;
  constraintViolationMax: number;
  energyRescaleSkippedDueHighResidual: boolean;
  energyRescaleResidualMax: number;
  relativeJointAngle: number | null;
  relativeJointAngleHistory: number[];
};

export type PhysicsState = {
  enabled: boolean;
};

export type Result = {
  ok: boolean;
  reason?: string;
};

export type SceneStoreState = {
  scene: Scene;
  pens: Record<string, Pen>;
  penTrails: Record<string, PenTrailStroke[]>;
  tool: ToolMode;
  drag: DragState;
  createStick: CreateStickState;
  createLine: LineCreateState;
  createCircle: CircleCreateState;
  selection: SelectionState;
  stickResize: StickResizeState;
  lineResize: LineResizeState;
  circleResize: CircleResizeState;
  solverOptions: SolverOptions;
  physicsOptions: PhysicsOptions;
  physicsDiagnostics: PhysicsDiagnostics;
  physics: PhysicsState;
};

export interface SceneStore {
  getState(): SceneStoreState;
  subscribe(listener: () => void): () => void;
  setTool(mode: ToolMode): void;
  addStick(start: Vec2, end: Vec2): Result;
  setAnchor(nodeId: string): Result;
  beginDrag(nodeId: string): Result;
  updateDrag(pointer: Vec2): Result;
  endDrag(): Result;
  beginStick(start: Vec2): Result;
  updateStickPreview(pointer: Vec2): Result;
  endStick(end: Vec2): Result;
  clearSelectionForTool(): void;
  selectAt(point: Vec2): SelectionHit | null;
  clearSelection(): void;
  tryHandleAnchorToolClick(point: Vec2): Result;
  tryHandleStickToolClick(point: Vec2): Result;
  tryBeginSelectedStickResizeAt(point: Vec2): Result;
  updateSelectedStickResize(pointer: Vec2): Result;
  endSelectedStickResize(): Result;
  beginLine(start: Vec2): Result;
  updateLinePreview(pointer: Vec2): Result;
  endLine(end: Vec2): Result;
  tryHandleLineToolClick(point: Vec2): Result;
  tryBeginSelectedLineResizeAt(point: Vec2): Result;
  updateSelectedLineResize(pointer: Vec2): Result;
  endSelectedLineResize(): Result;
  deleteSelectedLine(): Result;
  setPen(nodeId: string): Result;
  tryHandlePenToolClick(point: Vec2): Result;
  hitTestPen(point: Vec2): string | null;
  setPenColor(nodeId: string, color: string): Result;
  setPenEnabled(nodeId: string, enabled: boolean): Result;
  deleteSelectedPen(): Result;
  beginCircle(center: Vec2): Result;
  updateCirclePreview(pointer: Vec2): Result;
  endCircle(edgePoint: Vec2): Result;
  tryHandleCircleToolClick(point: Vec2): Result;
  tryBeginSelectedCircleResizeAt(point: Vec2): Result;
  updateSelectedCircleResize(pointer: Vec2): Result;
  endSelectedCircleResize(): Result;
  deleteSelectedCircle(): Result;
  deleteSelectedPivot(): Result;
  deleteSelectedAnchor(): Result;
  deleteSelectedStick(): Result;
  clearDrawing(): void;
  setPhysicsEnabled(enabled: boolean): void;
  setPhysicsOptions(opts: Partial<PhysicsOptions>): void;
  getPhysicsDiagnostics(): PhysicsDiagnostics;
  stepPhysics(dtSeconds: number): Result;
  tryAnchorAt(point: Vec2): Result;
  tryBeginDragAt(point: Vec2): Result;
}
