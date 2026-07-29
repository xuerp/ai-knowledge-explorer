import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { LocateFixed, Minus, Plus } from "lucide-react";
import type { Entity, EntityType, GraphEdge } from "@/domain/types";
import { useApp, pick } from "@/lib/app-state";
import { NODE_TYPE_META, type NodeShape } from "@/components/graph/config";
import { RELATION_LABELS } from "@/domain/labels";

const RADIUS: Record<EntityType, number> = {
  model: 22,
  company: 18,
  framework: 16,
  benchmark: 14,
  paper: 12,
  agent: 16,
  dataset: 12,
  api: 12,
  tool: 12,
  application: 14,
};

interface PositionedNode {
  entity: Entity;
  x: number;
  y: number;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

type Interaction =
  | {
      kind: "pan";
      pointerId: number;
      clientX: number;
      clientY: number;
      viewport: Viewport;
      moved: boolean;
    }
  | {
      kind: "node";
      pointerId: number;
      nodeId: string;
      clientX: number;
      clientY: number;
      position: { x: number; y: number };
      moved: boolean;
    };

const roundCoordinate = (value: number) => Number(value.toFixed(3));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function layout(
  entities: Entity[],
  centerId?: string,
  width = 900,
  height = 560,
): PositionedNode[] {
  if (!entities.length) return [];
  const centerX = width / 2;
  const centerY = height / 2;
  const center =
    entities.find((entity) => entity.id === centerId) ??
    entities.find((entity) => entity.type === "model") ??
    entities[0];
  const others = entities.filter((entity) => entity.id !== center.id);

  const orbits: Record<EntityType, number> = {
    model: 180,
    company: 90,
    framework: 240,
    benchmark: 240,
    paper: 260,
    application: 200,
    agent: 210,
    dataset: 250,
    api: 230,
    tool: 230,
  };

  const buckets = new Map<EntityType, Entity[]>();
  for (const entity of others) {
    const bucket = buckets.get(entity.type) ?? [];
    bucket.push(entity);
    buckets.set(entity.type, bucket);
  }

  const nodes: PositionedNode[] = [{ entity: center, x: centerX, y: centerY }];
  for (const [type, bucket] of buckets) {
    const radius = orbits[type] ?? 220;
    const startAngle = (
      {
        model: -Math.PI / 2,
        company: Math.PI,
        framework: Math.PI / 4,
        benchmark: -Math.PI / 4,
        paper: (3 * Math.PI) / 4,
        application: (-3 * Math.PI) / 4,
        agent: Math.PI / 2,
        dataset: Math.PI,
        api: Math.PI / 3,
        tool: -Math.PI / 3,
      } as Record<EntityType, number>
    )[type];
    bucket.forEach((entity, index) => {
      const step = (Math.PI * 1.2) / Math.max(bucket.length, 2);
      const angle = startAngle + (index - (bucket.length - 1) / 2) * step;
      nodes.push({
        entity,
        x: roundCoordinate(centerX + Math.cos(angle) * radius),
        y: roundCoordinate(centerY + Math.sin(angle) * radius),
      });
    });
  }
  return nodes;
}

function shapePoints(shape: NodeShape, radius: number) {
  if (shape === "diamond") return `0,${-radius} ${radius},0 0,${radius} ${-radius},0`;
  if (shape === "hexagon") {
    return Array.from({ length: 6 }, (_, index) => {
      const angle = (Math.PI / 3) * index - Math.PI / 2;
      return `${roundCoordinate(Math.cos(angle) * radius)},${roundCoordinate(Math.sin(angle) * radius)}`;
    }).join(" ");
  }
  return "";
}

function NodeMark({
  shape,
  radius,
  color,
  selected,
  tone,
}: {
  shape: NodeShape;
  radius: number;
  color: string;
  selected: boolean;
  tone: "light" | "dark";
}) {
  const common = {
    fill: color,
    stroke: selected ? (tone === "dark" ? "#fff" : "#111827") : "rgba(255,255,255,0.75)",
    strokeWidth: selected ? 2.5 : 1,
  };
  if (shape === "circle") return <circle r={radius} {...common} />;
  if (shape === "square") {
    return (
      <rect x={-radius} y={-radius} width={radius * 2} height={radius * 2} rx={4} {...common} />
    );
  }
  return <polygon points={shapePoints(shape, radius)} {...common} />;
}

function edgeAppearance(edge: GraphEdge, active: boolean) {
  if (active) {
    return { stroke: "var(--signal)", opacity: 0.95, width: 3, dash: undefined };
  }
  if (edge.confidence === "conflict") {
    return {
      stroke: "var(--conflict)",
      opacity: 0.9,
      width: 2,
      dash: "10 3 2 3",
    };
  }
  if (edge.confidence === "unverified") {
    return { stroke: "var(--graph-edge)", opacity: 0.55, width: 1.5, dash: "2 6" };
  }
  if (edge.confidence === "inferred") {
    return { stroke: "var(--graph-edge)", opacity: 0.7, width: 1.5, dash: "7 5" };
  }
  return { stroke: "var(--graph-edge)", opacity: 0.55, width: 1.25, dash: undefined };
}

export function KnowledgeGraph({
  entities,
  relations,
  entityIds,
  centerId,
  height = 560,
  onSelectNode,
  onSelectEdge,
  selectedNodeId,
  selectedEdgeId,
  highlightedNodeIds = [],
  highlightedEdgeIds = [],
  focusNodeId,
  canvasWidth = 900,
  tone = "light",
  showRelationLabels = true,
}: {
  entities: Entity[];
  relations: GraphEdge[];
  entityIds?: string[];
  centerId?: string;
  height?: number;
  onSelectNode?: (entity: Entity) => void;
  onSelectEdge?: (edge: GraphEdge) => void;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  highlightedNodeIds?: string[];
  highlightedEdgeIds?: string[];
  focusNodeId?: string | null;
  canvasWidth?: number;
  tone?: "light" | "dark";
  showRelationLabels?: boolean;
}) {
  const { lang, t } = useApp();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const lastFocusedRef = useRef<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });

  const visibleEntities = useMemo(
    () => (entityIds ? entities.filter((entity) => entityIds.includes(entity.id)) : entities),
    [entities, entityIds],
  );
  const width = canvasWidth;
  const baseNodes = useMemo(
    () => layout(visibleEntities, centerId, width, height),
    [visibleEntities, centerId, height, width],
  );
  const nodes = useMemo(
    () =>
      baseNodes.map((node) => ({
        ...node,
        ...(positions[node.entity.id] ?? {}),
      })),
    [baseNodes, positions],
  );
  const positionById = useMemo(() => new Map(nodes.map((node) => [node.entity.id, node])), [nodes]);
  const edges = useMemo(
    () =>
      relations.filter(
        (relation) => positionById.has(relation.fromId) && positionById.has(relation.toId),
      ),
    [positionById, relations],
  );
  const relationLabelCenterId =
    centerId ?? nodes.find((node) => node.entity.type === "model")?.entity.id;
  const highlightedNodes = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const highlightedEdges = useMemo(() => new Set(highlightedEdgeIds), [highlightedEdgeIds]);

  useEffect(() => {
    if (!focusNodeId || focusNodeId === lastFocusedRef.current) return;
    const node = baseNodes.find((item) => item.entity.id === focusNodeId);
    if (!node) return;
    lastFocusedRef.current = focusNodeId;
    setViewport((current) => ({
      ...current,
      x: width / 2 - node.x * current.scale,
      y: height / 2 - node.y * current.scale,
    }));
  }, [baseNodes, focusNodeId, height, width]);

  const resetViewport = () => {
    setViewport({ x: 0, y: 0, scale: 1 });
    setPositions({});
  };

  const zoomAtCenter = (factor: number) => {
    setViewport((current) => {
      const scale = clamp(current.scale * factor, 0.45, 2.8);
      const worldX = (width / 2 - current.x) / current.scale;
      const worldY = (height / 2 - current.y) / current.scale;
      return {
        scale,
        x: width / 2 - worldX * scale,
        y: height / 2 - worldY * scale,
      };
    });
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = ((event.clientX - rect.left) / rect.width) * width;
    const cursorY = ((event.clientY - rect.top) / rect.height) * height;
    setViewport((current) => {
      const scale = clamp(current.scale * (event.deltaY < 0 ? 1.12 : 0.89), 0.45, 2.8);
      const worldX = (cursorX - current.x) / current.scale;
      const worldY = (cursorY - current.y) / current.scale;
      return {
        scale,
        x: cursorX - worldX * scale,
        y: cursorY - worldY * scale,
      };
    });
  };

  const beginPan = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewport,
      moved: false,
    };
  };

  const beginNodeDrag = (event: PointerEvent<SVGGElement>, node: PositionedNode) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    interactionRef.current = {
      kind: "node",
      pointerId: event.pointerId,
      nodeId: node.entity.id,
      clientX: event.clientX,
      clientY: event.clientY,
      position: { x: node.x, y: node.y },
      moved: false,
    };
  };

  const moveInteraction = (event: PointerEvent<SVGSVGElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - interaction.clientX) / rect.width) * width;
    const deltaY = ((event.clientY - interaction.clientY) / rect.height) * height;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 2) interaction.moved = true;

    if (interaction.kind === "pan") {
      setViewport({
        ...interaction.viewport,
        x: interaction.viewport.x + deltaX,
        y: interaction.viewport.y + deltaY,
      });
      return;
    }

    setPositions((current) => ({
      ...current,
      [interaction.nodeId]: {
        x: roundCoordinate(interaction.position.x + deltaX / viewport.scale),
        y: roundCoordinate(interaction.position.y + deltaY / viewport.scale),
      },
    }));
  };

  const finishInteraction = (event: PointerEvent<SVGSVGElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => {
      interactionRef.current = null;
    }, 0);
  };

  const selectNode = (entity: Entity) => {
    if (interactionRef.current?.moved) return;
    onSelectNode?.(entity);
  };

  const onNodeKeyDown = (event: KeyboardEvent<SVGGElement>, entity: Entity) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectNode?.(entity);
  };

  const onEdgeKeyDown = (event: KeyboardEvent<SVGLineElement>, edge: GraphEdge) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelectEdge?.(edge);
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border ${
        tone === "dark" ? "border-white/10 bg-graph-bg" : "border-border bg-[#f8f9fb]"
      }`}
    >
      <div
        className={`absolute right-3 top-3 z-10 flex rounded-md border p-1 shadow-sm ${
          tone === "dark" ? "border-white/15 bg-graph-surface/90" : "border-border bg-white/95"
        }`}
      >
        <button
          type="button"
          onClick={() => zoomAtCenter(1.2)}
          className={`grid h-8 w-8 place-items-center rounded ${
            tone === "dark"
              ? "text-white/75 hover:bg-white/10 hover:text-white"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label={t("放大图谱", "Zoom in")}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomAtCenter(0.82)}
          className={`grid h-8 w-8 place-items-center rounded ${
            tone === "dark"
              ? "text-white/75 hover:bg-white/10 hover:text-white"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label={t("缩小图谱", "Zoom out")}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetViewport}
          className={`grid h-8 w-8 place-items-center rounded ${
            tone === "dark"
              ? "text-white/75 hover:bg-white/10 hover:text-white"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
          aria-label={t("重置图谱视图", "Reset graph view")}
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full touch-none select-none"
        onWheel={onWheel}
        onPointerDown={beginPan}
        onPointerMove={moveInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={finishInteraction}
        aria-label={t("可交互 AI 知识图谱", "Interactive AI knowledge graph")}
      >
        <defs>
          <radialGradient id="graph-glow" cx="50%" cy="50%">
            <stop
              offset="0%"
              stopColor={tone === "dark" ? "#fff" : "#5b5bd6"}
              stopOpacity={tone === "dark" ? "0.15" : "0.08"}
            />
            <stop offset="100%" stopColor={tone === "dark" ? "#fff" : "#5b5bd6"} stopOpacity="0" />
          </radialGradient>
          <pattern id="graph-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke={tone === "dark" ? "rgba(255,255,255,0.04)" : "rgba(17,24,39,0.055)"}
              strokeWidth="1"
            />
          </pattern>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graph-edge)" />
          </marker>
        </defs>
        <rect width={width} height={height} fill="url(#graph-grid)" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <circle cx={width / 2} cy={height / 2} r={280} fill="url(#graph-glow)" />

          {edges.map((edge, edgeIndex) => {
            const from = positionById.get(edge.fromId)!;
            const to = positionById.get(edge.toId)!;
            const active =
              highlightedEdges.has(edge.id) ||
              selectedEdgeId === edge.id ||
              Boolean(
                hoveredNodeId && (hoveredNodeId === edge.fromId || hoveredNodeId === edge.toId),
              );
            const appearance = edgeAppearance(edge, active);
            return (
              <g key={edge.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={appearance.stroke}
                  strokeOpacity={appearance.opacity}
                  strokeWidth={appearance.width}
                  strokeDasharray={appearance.dash}
                  markerEnd={edge.kind === "competes-with" ? undefined : "url(#graph-arrow)"}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                {showRelationLabels &&
                  (selectedEdgeId === edge.id ||
                    edge.fromId === relationLabelCenterId ||
                    edge.toId === relationLabelCenterId) && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 6 + ((edgeIndex % 3) - 1) * 10}
                      textAnchor="middle"
                      fill={tone === "dark" ? "rgba(255,255,255,0.8)" : "#475569"}
                      stroke={tone === "dark" ? "#090c13" : "#f8f9fb"}
                      strokeWidth="5"
                      paintOrder="stroke"
                      fontSize="9"
                      fontWeight="600"
                      letterSpacing="0.03em"
                      style={{ pointerEvents: "none" }}
                    >
                      {pick(RELATION_LABELS[edge.kind], lang)}
                    </text>
                  )}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="transparent"
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={t("查看关系证据", "Inspect relationship evidence")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectEdge?.(edge);
                  }}
                  onKeyDown={(event) => onEdgeKeyDown(event, edge)}
                />
              </g>
            );
          })}

          {nodes.map((node) => {
            const meta = NODE_TYPE_META[node.entity.type];
            const radius = RADIUS[node.entity.type];
            const isSelected = selectedNodeId === node.entity.id;
            const isHighlighted = highlightedNodes.has(node.entity.id);
            const isHovered = hoveredNodeId === node.entity.id;
            return (
              <g
                key={node.entity.id}
                transform={`translate(${node.x} ${node.y})`}
                className="cursor-grab outline-none focus-visible:[&>path]:stroke-white active:cursor-grabbing"
                role="button"
                tabIndex={0}
                aria-label={`${pick(node.entity.name, lang)} · ${pick(meta.label, lang)}`}
                onMouseEnter={() => setHoveredNodeId(node.entity.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onFocus={() => setHoveredNodeId(node.entity.id)}
                onBlur={() => setHoveredNodeId(null)}
                onPointerDown={(event) => beginNodeDrag(event, node)}
                onClick={() => selectNode(node.entity)}
                onKeyDown={(event) => onNodeKeyDown(event, node.entity)}
              >
                <circle
                  r={radius + 9}
                  fill={meta.color}
                  opacity={isHovered || isSelected || isHighlighted ? 0.28 : 0.08}
                />
                {isHighlighted && (
                  <circle
                    r={radius + 5}
                    fill="none"
                    stroke={tone === "dark" ? "#fff" : "#111827"}
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <NodeMark
                  shape={meta.shape}
                  radius={radius}
                  color={meta.color}
                  selected={isSelected}
                  tone={tone}
                />
                <text
                  y={radius + 18}
                  textAnchor="middle"
                  fill={tone === "dark" ? "rgba(255,255,255,0.94)" : "#111827"}
                  fontSize="12"
                  fontWeight={500}
                  style={{ pointerEvents: "none" }}
                >
                  {pick(node.entity.name, lang)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="sr-only">
        {t(
          "使用鼠标滚轮缩放，拖动画布平移，拖动节点调整位置。节点也可通过键盘选择。",
          "Use the wheel to zoom, drag the canvas to pan, and drag nodes to reposition. Nodes are keyboard selectable.",
        )}
      </p>
    </div>
  );
}
