import { memo, useMemo } from "react";
import type { EdgeProps, InternalNode, Node } from '@xyflow/react';
import { getBezierPath, useInternalNode } from '@xyflow/react';

import { getFloatingEdgePath, type EdgeRect } from "@/components/edges/floatingEdgePath";

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

/** The node's box in flow coordinates, or `null` while React Flow has yet to measure it. */
function rectOf(node: InternalNode<Node> | undefined): EdgeRect | null {
  if (!node) return null;
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  if (!width || !height) return null;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width, height };
}

function RelationEdgeImpl(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
  } = props;

  // Cards carry a target handle on the left and a source handle on the right, which would drag
  // every edge out to those two sides. The relation still runs source -> target, but it is drawn
  // between the card borders that actually face each other. `useInternalNode` re-renders this edge
  // when either node moves or is measured — and, unlike `useViewport`, not when the canvas is
  // panned or zoomed.
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const floating = useMemo(() => {
    const sourceRect = rectOf(sourceNode);
    const targetRect = rectOf(targetNode);
    if (!sourceRect || !targetRect) return null;
    return getFloatingEdgePath(sourceRect, targetRect);
  }, [sourceNode, targetNode]);

  // Until both nodes are measured there is no box to aim at, so fall back to the handle geometry
  // React Flow already worked out.
  const [handlePath, handleLabelX, handleLabelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const edgePath = floating?.path ?? handlePath;
  const labelX = floating?.labelX ?? handleLabelX;
  const labelY = floating?.labelY ?? handleLabelY;

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

  // When the canvas is abstracted, one drawn edge can stand for many real ones. Thickness carries
  // that count — logarithmically, so a 40-edge bundle does not become a black bar — and the label
  // says how many, because "referenced by" alone would understate a thread of twelve.
  const weight = typeof data?.weight === "number" && Number.isFinite(data.weight)
    ? Math.max(1, data.weight)
    : 1;
  const strokeWidth = weight > 1
    ? Math.min(9, 2.1 + (Math.log2(weight) * 1.4))
    : 2.1;
  const displayLabel = label && weight > 1 ? `${label} ×${weight}` : label;
  const labelWidth = displayLabel ? Math.max(56, Math.ceil(displayLabel.length * 8.2 + 16)) : 0;

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
        style={{ stroke: visual.stroke, strokeWidth }}
        markerStart={showSourceArrow ? `url(#${sourceMarkerId})` : undefined}
        markerEnd={markerEnd}
      />
      {displayLabel ? (
        <>
          <rect
            x={labelX - (labelWidth / 2)}
            y={labelY - 11}
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
            {displayLabel}
          </text>
        </>
      ) : null}
    </>
  );
}

export const RelationEdge = memo(RelationEdgeImpl);

