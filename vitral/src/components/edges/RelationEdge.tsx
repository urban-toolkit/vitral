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

/**
 * Every stroke colour `resolveEdgeVisual` can return. Kept as one list because
 * `RelationEdgeMarkerDefs` mints exactly one arrow marker per entry and the edges look theirs up by
 * colour — a new colour added only inside `resolveEdgeVisual` would resolve to a missing marker.
 */
const RELATION_EDGE_STROKES = ["#90b1e9", "#dda788", "#cccccc"] as const;

function relationMarkerId(stroke: string) {
  return `relation-arrow-${stroke.replace("#", "")}`;
}

/**
 * One `<marker>` per stroke colour for the whole canvas, rendered once inside `<ReactFlow>` instead
 * of a `<defs>` per edge — fifty near-identical marker definitions, each re-resolved wherever it was
 * painted. SVG fragment references are document-scoped, which is how React Flow's own
 * `MarkerDefinitions` reaches every edge's separate `<svg>` too.
 *
 * Zero-sized and `overflow: hidden` rather than `display: none`, because markers defined inside a
 * `display: none` subtree historically fail to resolve in some engines.
 */
export function RelationEdgeMarkerDefs() {
  return (
    <svg aria-hidden width={0} height={0} style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {RELATION_EDGE_STROKES.map((stroke) => (
          <marker
            key={stroke}
            id={relationMarkerId(stroke)}
            viewBox="0 0 10 10"
            refX={5}
            refY={5}
            markerWidth={7}
            markerHeight={7}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

type EdgeVisualStyle = {
  stroke: string;
  labelColor: string;
  labelBg: string;
};

function resolveEdgeVisual(kind: string, label: string | undefined): EdgeVisualStyle {
  if (kind === "referenced_by" || label?.toLowerCase() === REFERENCED_BY_LABEL) {
    return {
      stroke: RELATION_EDGE_STROKES[0],
      labelColor: "#1f4ca4",
      labelBg: "#e8f1ff",
    };
  }
  if (kind === "iteration_of" || label?.toLowerCase() === ITERATION_OF_LABEL) {
    return {
      stroke: RELATION_EDGE_STROKES[1],
      labelColor: "#7f3f1a",
      labelBg: "#fff1e8",
    };
  }
  return {
    stroke: RELATION_EDGE_STROKES[2],
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
  // React Flow already worked out. Lazily, because once both nodes are measured — which is every
  // render after the first — this bezier was being built and then discarded.
  const { path: edgePath, labelX, labelY } = useMemo(() => {
    if (floating) return { path: floating.path, labelX: floating.labelX, labelY: floating.labelY };
    const [path, handleLabelX, handleLabelY] = getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    return { path, labelX: handleLabelX, labelY: handleLabelY };
  }, [floating, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  const rawLabel = data?.label ?? props.label;
  const label: string | undefined =
    typeof rawLabel === 'string' ? rawLabel : undefined;
  const kind = typeof data?.kind === "string" ? data.kind : "";
  const visual = resolveEdgeVisual(kind, label);
  const sourceLabel = typeof data?.from === "string" ? data.from.toLowerCase() : "";
  const targetLabel = typeof data?.to === "string" ? data.to.toLowerCase() : "";
  const showSourceArrow =
    CARD_EDGE_LABELS.has(sourceLabel) && CARD_EDGE_LABELS.has(targetLabel);
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
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{ stroke: visual.stroke, strokeWidth }}
        markerStart={showSourceArrow ? `url(#${relationMarkerId(visual.stroke)})` : undefined}
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

