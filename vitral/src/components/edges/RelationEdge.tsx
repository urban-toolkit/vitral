import type { EdgeProps } from '@xyflow/react';
import { getBezierPath } from '@xyflow/react';

const CARD_EDGE_LABELS = new Set([
  "person",
  "activity",
  "requirement",
  "concept",
  "insight",
  "object",
  "task",
]);

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
  const sourceLabel = typeof data?.from === "string" ? data.from.toLowerCase() : "";
  const targetLabel = typeof data?.to === "string" ? data.to.toLowerCase() : "";
  const showSourceArrow =
    CARD_EDGE_LABELS.has(sourceLabel) && CARD_EDGE_LABELS.has(targetLabel);
  const sourceMarkerId = `relation-edge-source-${id}`;

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
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f2f2f" />
          </marker>
        </defs>
      ) : null}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerStart={showSourceArrow ? `url(#${sourceMarkerId})` : undefined}
        markerEnd={markerEnd}
      />
      {label ? (
        <>
          <text
            x={labelX}
            y={labelY}
            style={{ fontSize: 15, pointerEvents: 'none', fill: '#222'}}
          >
            {label}
          </text>
          <rect
            x={labelX - 5}
            y={labelY - 15}
            width={100}
            height={20}
            style={{ pointerEvents: 'none', fill: '#e4e4e450'}}
          >
          </rect>
        </>
      ) : null}
    </>
  );
}

