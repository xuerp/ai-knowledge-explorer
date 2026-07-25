import { useMemo, useState } from "react";
import { ENTITIES, RELATIONS, type Entity, type EntityType } from "@/lib/demo-data";
import { useApp, pick } from "@/lib/app-context";

const TYPE_COLOR: Record<EntityType, string> = {
  model: "var(--graph-node-model)",
  agent: "var(--graph-node-agent)",
  paper: "var(--graph-node-paper)",
  benchmark: "var(--graph-node-benchmark)",
  company: "var(--graph-node-company)",
  framework: "var(--graph-node-framework)",
  dataset: "var(--graph-node-paper)",
  api: "var(--graph-node-framework)",
  tool: "var(--graph-node-framework)",
  application: "var(--graph-node-agent)",
};

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

interface Node {
  entity: Entity;
  x: number;
  y: number;
}

// Deterministic radial layout: center = GPT (or first), others by orbit based on type
function layout(entities: Entity[], centerId?: string, w = 900, h = 560): Node[] {
  const cx = w / 2;
  const cy = h / 2;
  const center =
    entities.find((e) => e.id === centerId) ??
    entities.find((e) => e.type === "model") ??
    entities[0];
  const others = entities.filter((e) => e.id !== center.id);

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
  for (const e of others) {
    const arr = buckets.get(e.type) ?? [];
    arr.push(e);
    buckets.set(e.type, arr);
  }

  const nodes: Node[] = [{ entity: center, x: cx, y: cy }];
  for (const [type, arr] of buckets) {
    const r = orbits[type] ?? 220;
    const startAngle = ({
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
    } as Record<EntityType, number>)[type];
    arr.forEach((e, i) => {
      const step = (Math.PI * 1.2) / Math.max(arr.length, 2);
      const angle = startAngle + (i - (arr.length - 1) / 2) * step;
      nodes.push({ entity: e, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    });
  }
  return nodes;
}

export function KnowledgeGraph({
  entityIds,
  centerId,
  height = 560,
  onSelect,
  selectedId,
}: {
  entityIds?: string[];
  centerId?: string;
  height?: number;
  onSelect?: (e: Entity) => void;
  selectedId?: string | null;
}) {
  const { lang } = useApp();
  const [hover, setHover] = useState<string | null>(null);
  const entities = useMemo(
    () => (entityIds ? ENTITIES.filter((e) => entityIds.includes(e.id)) : ENTITIES),
    [entityIds],
  );
  const w = 900;
  const nodes = useMemo(() => layout(entities, centerId, w, height), [entities, centerId, height]);
  const posMap = new Map(nodes.map((n) => [n.entity.id, n]));
  const edges = RELATIONS.filter((r) => posMap.has(r.fromId) && posMap.has(r.toId));

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-white/10 bg-graph-bg">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto block">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={w} height={height} fill="url(#grid)" />
        <circle cx={w / 2} cy={height / 2} r={280} fill="url(#glow)" />

        {edges.map((r) => {
          const a = posMap.get(r.fromId)!;
          const b = posMap.get(r.toId)!;
          const active =
            hover && (hover === r.fromId || hover === r.toId)
              ? true
              : selectedId && (selectedId === r.fromId || selectedId === r.toId)
                ? true
                : false;
          return (
            <line
              key={r.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "var(--graph-node-model)" : "var(--graph-edge)"}
              strokeOpacity={active ? 0.9 : 0.35}
              strokeWidth={active ? 1.5 : 1}
              strokeDasharray={r.confidence === "unverified" ? "4 4" : undefined}
            />
          );
        })}

        {nodes.map((n) => {
          const color = TYPE_COLOR[n.entity.type];
          const r = RADIUS[n.entity.type];
          const isSelected = selectedId === n.entity.id;
          const isHover = hover === n.entity.id;
          return (
            <g
              key={n.entity.id}
              transform={`translate(${n.x} ${n.y})`}
              className="cursor-pointer"
              onMouseEnter={() => setHover(n.entity.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(n.entity)}
            >
              <circle
                r={r + 6}
                fill={color}
                opacity={isHover || isSelected ? 0.25 : 0.1}
              />
              <circle
                r={r}
                fill={color}
                stroke={isSelected ? "#fff" : "rgba(255,255,255,0.35)"}
                strokeWidth={isSelected ? 2 : 1}
              />
              <text
                y={r + 16}
                textAnchor="middle"
                fill="rgba(255,255,255,0.92)"
                fontSize="12"
                fontWeight={500}
                style={{ pointerEvents: "none" }}
              >
                {pick(n.entity.name, lang)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export const NODE_TYPES: { type: EntityType; zh: string; en: string }[] = [
  { type: "model", zh: "模型", en: "Model" },
  { type: "company", zh: "公司", en: "Company" },
  { type: "framework", zh: "框架 / 协议", en: "Framework" },
  { type: "benchmark", zh: "评测", en: "Benchmark" },
  { type: "paper", zh: "论文", en: "Paper" },
  { type: "application", zh: "应用", en: "Application" },
];
