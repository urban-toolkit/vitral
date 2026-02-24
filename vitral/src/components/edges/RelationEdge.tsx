import type { EdgeProps } from '@xyflow/react';
import { getBezierPath } from '@xyflow/react';

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

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
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

