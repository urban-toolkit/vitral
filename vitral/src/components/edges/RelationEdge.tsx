import type { EdgeProps } from '@xyflow/react';
import { getBezierPath } from '@xyflow/react';

const CARD_EDGE_LABELS = new Set([
  "person",
  "activity",
  "requirement",
  "concept",
  "insight",
  "object",
]);
const REFERENCED_BY_LABEL = "referenced by";
const ITERATION_OF_LABEL = "iteration of";

type EdgeVisualStyle = {
  stroke: string;
  labelColor: string;
  labelBg: string;
};

function resolveEdgeVisual(kind: string, label: string | undefined): EdgeVisualStyle {
  if (kind === "referenced_by" || label?.toLowerCase() === REFERENCED_BY_LABEL) {
    return {
      stroke: "#90b1e9",
      labelColor: "#1f4ca4",
      labelBg: "#e8f1ff",
    };
  }
  if (kind === "iteration_of" || label?.toLowerCase() === ITERATION_OF_LABEL) {
    return {
      stroke: "#dda788",
      labelColor: "#7f3f1a",
      labelBg: "#fff1e8",
    };
  }
  return {
    stroke: "#cccccc",
    labelColor: "#222",
    labelBg: "#f0f0f0",
  };
}

export function RelationEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
  } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const rawLabel = data?.label ?? props.label;
  const label: string | undefined =
    typeof rawLabel === 'string' ? rawLabel : undefined;
  const kind = typeof data?.kind === "string" ? data.kind : "";
  const visual = resolveEdgeVisual(kind, label);
  const sourceLabel = typeof data?.from === "string" ? data.from.toLowerCase() : "";
  const targetLabel = typeof data?.to === "string" ? data.to.toLowerCase() : "";
  const showSourceArrow =
    CARD_EDGE_LABELS.has(sourceLabel) && CARD_EDGE_LABELS.has(targetLabel);
  const sourceMarkerId = `relation-edge-source-${id}`;
  const labelWidth = label ? Math.max(56, Math.ceil(label.length * 8.2 + 16)) : 0;

  return (
    <>
      {showSourceArrow ? (
        <defs>
          <marker
            id={sourceMarkerId}
            viewBox="0 0 10 10"
            refX={5}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={visual.stroke} />
          </marker>
        </defs>
      ) : null}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{ stroke: visual.stroke, strokeWidth: 2.1 }}
        markerStart={showSourceArrow ? `url(#${sourceMarkerId})` : undefined}
        markerEnd={markerEnd}
      />
      {label ? (
        <>
          <rect
            x={labelX - (labelWidth / 2)}
            y={labelY - 14}
            width={labelWidth}
            height={20}
            rx={6}
            ry={6}
            style={{ pointerEvents: 'none', fill: visual.labelBg }}
          >
          </rect>
          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: 12,
              fontWeight: 700,
              pointerEvents: 'none',
              fill: visual.labelColor,
              textTransform: 'lowercase',
            }}
          >
            {label}
          </text>
        </>
      ) : null}
    </>
  );
}

