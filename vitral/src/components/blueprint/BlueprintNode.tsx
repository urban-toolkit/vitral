import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type {
    BlueprintData,
    BlueprintHighBlock,
    BlueprintIntermediate,
    BlueprintComponent,
    nodeType,
} from "@/config/types";
import classes from "./BlueprintNode.module.css";

const NODE_WIDTH = 720;
const OUTER_PADDING = 12;
const TITLE_HEIGHT = 30;
const TITLE_GAP = 10;
const HIGH_GAP = 10;
const HIGH_PADDING = 8;
const HIGH_TITLE_HEIGHT = 18;
const HIGH_TITLE_GAP = 6;
const INTERMEDIATE_GAP = 8;
const INTERMEDIATE_PADDING = 8;
const INTERMEDIATE_TITLE_HEIGHT = 14;
const INTERMEDIATE_TITLE_GAP = 6;
const INTERMEDIATE_BOTTOM_PAD = 8;
const COMPONENT_SIZE = 56;
const COMPONENT_GAP = 10;

type LayoutComponent = {
    key: string;
    id: number;
    name: string;
    feedsInto: number[];
    x: number;
    y: number;
    cx: number;
    cy: number;
};

type LayoutIntermediate = {
    key: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    components: LayoutComponent[];
};

type LayoutHigh = {
    key: string;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    intermediates: LayoutIntermediate[];
};

type LayoutEdge = {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

type BlueprintLayout = {
    width: number;
    height: number;
    highBlocks: LayoutHigh[];
    edges: LayoutEdge[];
};

function truncateLabel(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

function splitCircleLabel(text: string, maxCharsPerLine: number, maxLines: number): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return [""];

    const maxChars = maxCharsPerLine * maxLines;
    const capped = normalized.length > maxChars
        ? `${normalized.slice(0, Math.max(1, maxChars - 3))}...`
        : normalized;

    const lines: string[] = [];
    for (let index = 0; index < capped.length; index += maxCharsPerLine) {
        lines.push(capped.slice(index, index + maxCharsPerLine));
    }

    return lines.slice(0, maxLines);
}

function getIntermediateColumns(count: number): number {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
}

function safeBlueprintData(data: nodeType["data"]): BlueprintData | null {
    const candidate = (data as { blueprint?: unknown }).blueprint;
    if (!candidate || typeof candidate !== "object") return null;

    const blueprint = candidate as Partial<BlueprintData>;
    if (!Array.isArray(blueprint.highBlocks)) return null;
    if (!Array.isArray(blueprint.components)) return null;
    if (typeof blueprint.fileName !== "string") return null;
    if (typeof blueprint.paperTitle !== "string") return null;
    if (typeof blueprint.year !== "number") return null;

    return blueprint as BlueprintData;
}

function computeBlueprintLayout(blueprint: BlueprintData): BlueprintLayout {
    const width = NODE_WIDTH;
    const highX = OUTER_PADDING + 4;
    const highWidth = width - (highX * 2);
    const highInnerX = highX + HIGH_PADDING;
    const highInnerWidth = highWidth - (HIGH_PADDING * 2);
    let currentHighY = OUTER_PADDING + TITLE_HEIGHT + TITLE_GAP;

    const componentById = new Map<number, LayoutComponent>();
    const highBlocks: LayoutHigh[] = [];

    for (let highIndex = 0; highIndex < blueprint.highBlocks.length; highIndex++) {
        const high = blueprint.highBlocks[highIndex];
        const intermediates = high.intermediates;
        const columns = getIntermediateColumns(intermediates.length);
        const rowCount = Math.max(1, Math.ceil(intermediates.length / columns));
        const intermediateWidth = (
            highInnerWidth - (Math.max(0, columns - 1) * INTERMEDIATE_GAP)
        ) / Math.max(1, columns);

        type Measure = {
            row: number;
            col: number;
            height: number;
            circlesPerRow: number;
            source: BlueprintIntermediate;
        };
        const measures: Measure[] = [];
        const rowHeights = new Array<number>(rowCount).fill(0);

        for (let intermediateIndex = 0; intermediateIndex < intermediates.length; intermediateIndex++) {
            const source = intermediates[intermediateIndex];
            const row = Math.floor(intermediateIndex / columns);
            const col = intermediateIndex % columns;

            const circleAreaWidth = intermediateWidth - (INTERMEDIATE_PADDING * 2);
            const circlesPerRow = Math.max(
                1,
                Math.floor((circleAreaWidth + COMPONENT_GAP) / (COMPONENT_SIZE + COMPONENT_GAP)),
            );
            const rows = Math.max(1, Math.ceil(source.components.length / circlesPerRow));
            const circlesHeight = (
                rows * COMPONENT_SIZE +
                Math.max(0, rows - 1) * COMPONENT_GAP
            );
            const height = (
                (INTERMEDIATE_PADDING * 2) +
                INTERMEDIATE_TITLE_HEIGHT +
                INTERMEDIATE_TITLE_GAP +
                circlesHeight +
                INTERMEDIATE_BOTTOM_PAD
            );

            measures.push({ row, col, height, circlesPerRow, source });
            rowHeights[row] = Math.max(rowHeights[row], height);
        }

        const rowOffsets = new Array<number>(rowCount).fill(0);
        for (let row = 1; row < rowCount; row++) {
            rowOffsets[row] = rowOffsets[row - 1] + rowHeights[row - 1] + INTERMEDIATE_GAP;
        }

        const intermediateTop = currentHighY + HIGH_PADDING + HIGH_TITLE_HEIGHT + HIGH_TITLE_GAP;
        const gridHeight = rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowCount - 1) * INTERMEDIATE_GAP;
        const highHeight = (
            (HIGH_PADDING * 2) +
            HIGH_TITLE_HEIGHT +
            HIGH_TITLE_GAP +
            gridHeight
        );

        const layoutIntermediates: LayoutIntermediate[] = [];

        for (let intermediateIndex = 0; intermediateIndex < measures.length; intermediateIndex++) {
            const measure = measures[intermediateIndex];
            const x = highInnerX + measure.col * (intermediateWidth + INTERMEDIATE_GAP);
            const y = intermediateTop + rowOffsets[measure.row];
            const components: LayoutComponent[] = [];

            const componentBaseX = x + INTERMEDIATE_PADDING;
            const componentBaseY = y + INTERMEDIATE_PADDING + INTERMEDIATE_TITLE_HEIGHT + INTERMEDIATE_TITLE_GAP;

            for (let componentIndex = 0; componentIndex < measure.source.components.length; componentIndex++) {
                const sourceComponent = measure.source.components[componentIndex];
                const compRow = Math.floor(componentIndex / measure.circlesPerRow);
                const compCol = componentIndex % measure.circlesPerRow;
                const compX = componentBaseX + compCol * (COMPONENT_SIZE + COMPONENT_GAP);
                const compY = componentBaseY + compRow * (COMPONENT_SIZE + COMPONENT_GAP);

                const component: LayoutComponent = {
                    key: `${highIndex}-${intermediateIndex}-${componentIndex}`,
                    id: sourceComponent.id,
                    name: sourceComponent.name,
                    feedsInto: sourceComponent.feedsInto,
                    x: compX,
                    y: compY,
                    cx: compX + COMPONENT_SIZE / 2,
                    cy: compY + COMPONENT_SIZE / 2,
                };
                components.push(component);

                if (!componentById.has(component.id)) {
                    componentById.set(component.id, component);
                }
            }

            layoutIntermediates.push({
                key: `${highIndex}-${intermediateIndex}`,
                name: measure.source.name,
                x,
                y,
                width: intermediateWidth,
                height: measure.height,
                components,
            });
        }

        highBlocks.push({
            key: `${highIndex}`,
            name: high.name,
            x: highX,
            y: currentHighY,
            width: highWidth,
            height: highHeight,
            intermediates: layoutIntermediates,
        });

        currentHighY += highHeight + HIGH_GAP;
    }

    const edges: LayoutEdge[] = [];
    const edgeKeySet = new Set<string>();

    for (const source of componentById.values()) {
        for (const targetId of source.feedsInto) {
            const target = componentById.get(targetId);
            if (!target || target.id === source.id) continue;

            const key = `${source.key}->${target.key}`;
            if (edgeKeySet.has(key)) continue;
            edgeKeySet.add(key);

            edges.push({
                key,
                x1: source.cx,
                y1: source.cy,
                x2: target.cx,
                y2: target.cy,
            });
        }
    }

    return {
        width,
        height: Math.max(280, currentHighY + OUTER_PADDING),
        highBlocks,
        edges,
    };
}

function BlueprintNodeImpl(props: NodeProps<nodeType>) {
    const blueprint = safeBlueprintData(props.data);
    const layout = useMemo(
        () => (blueprint ? computeBlueprintLayout(blueprint) : null),
        [blueprint],
    );

    if (!blueprint || !layout) {
        return (
            <div className={classes.blueprintNode} style={{ width: 280, height: 120 }}>
                <div className={classes.blueprintFallback}>Invalid blueprint payload</div>
            </div>
        );
    }

    return (
        <div className={classes.blueprintNode} style={{ width: layout.width, height: layout.height }}>
            <div className={classes.blueprintOuter}>
                <div className={classes.blueprintTitle} title={blueprint.paperTitle}>
                    Blueprint: {truncateLabel(blueprint.paperTitle, 90)}
                </div>

                <svg className={classes.blueprintEdgesLayer} width={layout.width} height={layout.height}>
                    {layout.edges.map((edge) => (
                        <line
                            key={edge.key}
                            x1={edge.x1}
                            y1={edge.y1}
                            x2={edge.x2}
                            y2={edge.y2}
                            className={classes.blueprintEdge}
                        />
                    ))}
                </svg>

                {layout.highBlocks.map((high) => (
                    <div
                        key={high.key}
                        className={classes.blueprintHigh}
                        style={{
                            left: high.x,
                            top: high.y,
                            width: high.width,
                            height: high.height,
                        }}
                    >
                        <div className={classes.blueprintHighLabel} title={high.name}>
                            {truncateLabel(high.name, 90)}
                        </div>

                        {high.intermediates.map((intermediate) => (
                            <div
                                key={intermediate.key}
                                className={classes.blueprintIntermediate}
                                style={{
                                    left: intermediate.x - high.x,
                                    top: intermediate.y - high.y,
                                    width: intermediate.width,
                                    height: intermediate.height,
                                }}
                            >
                                <div className={classes.blueprintIntermediateLabel} title={intermediate.name}>
                                    {truncateLabel(intermediate.name, 70)}
                                </div>

                                {intermediate.components.map((component) => (
                                    <div
                                        key={component.key}
                                        className={classes.blueprintComponent}
                                        style={{
                                            left: component.x - intermediate.x,
                                            top: component.y - intermediate.y,
                                            width: COMPONENT_SIZE,
                                            height: COMPONENT_SIZE,
                                        }}
                                        title={component.name}
                                    >
                                        {splitCircleLabel(component.name, 8, 3).map((line, index) => (
                                            <span key={`${component.key}-line-${index}`} className={classes.blueprintComponentText}>
                                                {line}
                                            </span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            <Handle type="source" position={Position.Left} />
            <Handle type="target" position={Position.Right} />
        </div>
    );
}

export const BlueprintNode = memo(BlueprintNodeImpl);

