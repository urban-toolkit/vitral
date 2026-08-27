import type { QuerySystemComponentsResult } from "@/api/stateApi";
import type {
    BlueprintComponent,
    BlueprintData,
    BlueprintHighBlock,
    BlueprintIntermediate,
    edgeType,
    nodeType,
} from "@/config/types";
import type { BlueprintDragPayload } from "@/components/blueprint/blueprintDnD";

/**
 * Turning a system paper, or a handful of components picked out of several, into canvas nodes.
 *
 * Lifted out of `ProjectEditorPage` when the tray arrived: both the tray's drop handler and the
 * page's need it, and 340 lines of nested layout arithmetic living inside a 5000-line component was
 * already the wrong place for it.
 */

/**
 * The size a component circle is drawn at, and the pitch the grids below are built from.
 *
 * Every node built here declares its size as top-level `width`/`height` as well as in `style`.
 * React Flow keeps a node `visibility: hidden` until it has dimensions and reads them from the
 * former; `style` reaches only the DOM, so a node sized purely through it waits on a measurement
 * round trip — and stays invisible forever if the observer never fires. On the canvas that was
 * masked, because `activityOrbitLayout` carries a size across for everything it places. The tray
 * has no layout pass, so the size has to be true at construction.
 */
export const BLUEPRINT_COMPONENT_SIZE_PX = 112;

export function toBlueprintData(payload: BlueprintDragPayload): BlueprintData {
    const highBlocks: BlueprintHighBlock[] = payload.paper.HighBlocks.map((high) => ({
        name: high.HighBlockName,
        intermediates: high.IntermediateBlocks.map((intermediate): BlueprintIntermediate => ({
            name: intermediate.IntermediateBlockName,
            components: intermediate.GranularBlocks.map((granular): BlueprintComponent => ({
                id: granular.ID,
                name: granular.GranularBlockName,
                feedsInto: Array.isArray(granular.FeedsInto) ? granular.FeedsInto : [],
                description: granular.PaperDescription,
                referenceCitation: granular.ReferenceCitation,
                highBlockName: high.HighBlockName,
                intermediateBlockName: intermediate.IntermediateBlockName,
            })),
        })),
    }));

    const components = highBlocks.flatMap((high) =>
        high.intermediates.flatMap((intermediate) => intermediate.components),
    );

    return {
        fileName: payload.fileName,
        paperTitle: payload.paperTitle,
        year: payload.year,
        highBlocks,
        components,
    };
}

export function buildBlueprintComponentGraph(
    payload: BlueprintDragPayload,
    dropPosition: { x: number; y: number },
    createdAt?: string,
): { nodes: nodeType[]; edges: edgeType[] } {
    const blueprint = toBlueprintData(payload);

    const nodes: nodeType[] = [];
    const edges: edgeType[] = [];
    const nodeIdByComponentId = new Map<number, string>();
    const edgeKeySet = new Set<string>();

    const HIGH_BLOCK_GAP_X = 120;
    const PAPER_PADDING_X = 28;
    const PAPER_CONTENT_TOP = 54;
    const PAPER_PADDING_BOTTOM = 24;
    const PAPER_MIN_WIDTH = 360;
    const PAPER_MIN_HEIGHT = 220;
    const HIGH_PADDING_X = 22;
    const HIGH_CONTENT_TOP = 46;
    const HIGH_PADDING_BOTTOM = 22;
    const INTERMEDIATE_GAP_X = 28;
    const INTERMEDIATE_GAP_Y = 28;
    const INTERMEDIATE_PADDING_X = 18;
    const INTERMEDIATE_CONTENT_TOP = 42;
    const INTERMEDIATE_PADDING_BOTTOM = 18;
    const COMPONENT_SIZE = 112;
    const COMPONENT_GAP_X = 24;
    const COMPONENT_GAP_Y = 24;

    const getIntermediateColumns = (count: number): number => {
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        return 3;
    };

    const getComponentColumns = (count: number): number => {
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        if (count <= 9) return 3;
        return 4;
    };

    type IntermediateLayout = {
        intermediate: BlueprintIntermediate;
        componentColumns: number;
        width: number;
        height: number;
    };

    type HighLayout = {
        high: BlueprintHighBlock;
        intermediateColumns: number;
        intermediateLayouts: IntermediateLayout[];
        columnOffsets: number[];
        rowOffsets: number[];
        highWidth: number;
        highHeight: number;
    };

    const highLayouts: HighLayout[] = [];

    for (let highIndex = 0; highIndex < blueprint.highBlocks.length; highIndex++) {
        const high = blueprint.highBlocks[highIndex];
        const intermediateColumns = getIntermediateColumns(high.intermediates.length);
        const intermediateRows = Math.max(1, Math.ceil(high.intermediates.length / intermediateColumns));

        const intermediateLayouts: IntermediateLayout[] = high.intermediates.map((intermediate) => {
            const componentCount = intermediate.components.length;
            const componentColumns = getComponentColumns(componentCount);
            const componentRows = Math.max(1, Math.ceil(componentCount / componentColumns));
            const componentAreaWidth = (
                componentColumns * COMPONENT_SIZE +
                Math.max(0, componentColumns - 1) * COMPONENT_GAP_X
            );
            const componentAreaHeight = (
                componentRows * COMPONENT_SIZE +
                Math.max(0, componentRows - 1) * COMPONENT_GAP_Y
            );
            const width = INTERMEDIATE_PADDING_X * 2 + componentAreaWidth;
            const height = INTERMEDIATE_CONTENT_TOP + componentAreaHeight + INTERMEDIATE_PADDING_BOTTOM;

            return {
                intermediate,
                componentColumns,
                width,
                height,
            };
        });

        const columnWidths = new Array<number>(intermediateColumns).fill(0);
        const rowHeights = new Array<number>(intermediateRows).fill(0);

        for (let intermediateIndex = 0; intermediateIndex < intermediateLayouts.length; intermediateIndex++) {
            const intermediateCol = intermediateIndex % intermediateColumns;
            const intermediateRow = Math.floor(intermediateIndex / intermediateColumns);
            const layout = intermediateLayouts[intermediateIndex];
            columnWidths[intermediateCol] = Math.max(columnWidths[intermediateCol], layout.width);
            rowHeights[intermediateRow] = Math.max(rowHeights[intermediateRow], layout.height);
        }

        const columnOffsets = new Array<number>(intermediateColumns).fill(0);
        for (let index = 1; index < intermediateColumns; index++) {
            columnOffsets[index] = (
                columnOffsets[index - 1] +
                columnWidths[index - 1] +
                INTERMEDIATE_GAP_X
            );
        }

        const rowOffsets = new Array<number>(intermediateRows).fill(0);
        for (let index = 1; index < intermediateRows; index++) {
            rowOffsets[index] = (
                rowOffsets[index - 1] +
                rowHeights[index - 1] +
                INTERMEDIATE_GAP_Y
            );
        }

        const intermediateGridWidth = (
            columnWidths.reduce((total, width) => total + width, 0) +
            Math.max(0, intermediateColumns - 1) * INTERMEDIATE_GAP_X
        );
        const intermediateGridHeight = (
            rowHeights.reduce((total, height) => total + height, 0) +
            Math.max(0, intermediateRows - 1) * INTERMEDIATE_GAP_Y
        );

        const highWidth = HIGH_PADDING_X * 2 + intermediateGridWidth;
        const highHeight = HIGH_CONTENT_TOP + intermediateGridHeight + HIGH_PADDING_BOTTOM;
        highLayouts.push({
            high,
            intermediateColumns,
            intermediateLayouts,
            columnOffsets,
            rowOffsets,
            highWidth,
            highHeight,
        });
    }

    const totalHighWidth = (
        highLayouts.reduce((total, layout) => total + layout.highWidth, 0) +
        Math.max(0, highLayouts.length - 1) * HIGH_BLOCK_GAP_X
    );
    const tallestHigh = highLayouts.reduce(
        (maxHeight, layout) => Math.max(maxHeight, layout.highHeight),
        0,
    );
    const paperWidth = Math.max(PAPER_MIN_WIDTH, PAPER_PADDING_X * 2 + totalHighWidth);
    const paperHeight = Math.max(PAPER_MIN_HEIGHT, PAPER_CONTENT_TOP + tallestHigh + PAPER_PADDING_BOTTOM);
    const paperTitle = Number.isFinite(blueprint.year) && blueprint.year > 0
        ? `${blueprint.paperTitle} (${blueprint.year})`
        : blueprint.paperTitle;
    const paperNodeId = crypto.randomUUID();

    nodes.push({
        id: paperNodeId,
        position: {
            x: dropPosition.x,
            y: dropPosition.y,
        },
        type: "blueprintGroup",
        width: paperWidth,
        height: paperHeight,
        style: {
            width: paperWidth,
            height: paperHeight,
        },
        zIndex: 0,
        data: {
            label: "blueprint_group",
            type: "technical",
            title: paperTitle,
            description: "System Paper",
            ...(createdAt ? { createdAt } : {}),
            blueprintGroupLevel: "paper",
            blueprintPaperTitle: blueprint.paperTitle,
            blueprintFileName: blueprint.fileName,
        },
    });

    let highCursorX = PAPER_PADDING_X;
    for (let highIndex = 0; highIndex < highLayouts.length; highIndex++) {
        const highLayout = highLayouts[highIndex];
        const highNodeId = crypto.randomUUID();

        nodes.push({
            id: highNodeId,
            parentId: paperNodeId,
            extent: "parent",
            position: {
                x: highCursorX,
                y: PAPER_CONTENT_TOP,
            },
            type: "blueprintGroup",
            width: highLayout.highWidth,
            height: highLayout.highHeight,
            style: {
                width: highLayout.highWidth,
                height: highLayout.highHeight,
            },
            zIndex: 1,
            data: {
                label: "blueprint_group",
                type: "technical",
                title: highLayout.high.name,
                description: "High Block",
                ...(createdAt ? { createdAt } : {}),
                blueprintGroupLevel: "high",
                blueprintPaperTitle: blueprint.paperTitle,
                blueprintFileName: blueprint.fileName,
            },
        });

        for (let intermediateIndex = 0; intermediateIndex < highLayout.intermediateLayouts.length; intermediateIndex++) {
            const intermediateLayout = highLayout.intermediateLayouts[intermediateIndex];
            const intermediate = intermediateLayout.intermediate;
            const intermediateCol = intermediateIndex % highLayout.intermediateColumns;
            const intermediateRow = Math.floor(intermediateIndex / highLayout.intermediateColumns);
            const intermediateNodeId = crypto.randomUUID();

            nodes.push({
                id: intermediateNodeId,
                parentId: highNodeId,
                extent: "parent",
                position: {
                    x: HIGH_PADDING_X + highLayout.columnOffsets[intermediateCol],
                    y: HIGH_CONTENT_TOP + highLayout.rowOffsets[intermediateRow],
                },
                type: "blueprintGroup",
                width: intermediateLayout.width,
                height: intermediateLayout.height,
                style: {
                    width: intermediateLayout.width,
                    height: intermediateLayout.height,
                },
                zIndex: 2,
                data: {
                    label: "blueprint_group",
                    type: "technical",
                    title: intermediate.name,
                    description: "Intermediate Block",
                    ...(createdAt ? { createdAt } : {}),
                    blueprintGroupLevel: "intermediate",
                    blueprintPaperTitle: blueprint.paperTitle,
                    blueprintFileName: blueprint.fileName,
                },
            });

            for (let componentIndex = 0; componentIndex < intermediate.components.length; componentIndex++) {
                const component = intermediate.components[componentIndex];
                const componentCol = componentIndex % intermediateLayout.componentColumns;
                const componentRow = Math.floor(componentIndex / intermediateLayout.componentColumns);
                const nodeId = crypto.randomUUID();

                nodes.push({
                    id: nodeId,
                    parentId: intermediateNodeId,
                    extent: "parent",
                    position: {
                        x: INTERMEDIATE_PADDING_X + componentCol * (COMPONENT_SIZE + COMPONENT_GAP_X),
                        y: INTERMEDIATE_CONTENT_TOP + componentRow * (COMPONENT_SIZE + COMPONENT_GAP_Y),
                    },
                    type: "blueprintComponent",
                    width: COMPONENT_SIZE,
                    height: COMPONENT_SIZE,
                    zIndex: 3,
                    data: {
                        label: "blueprint_component",
                        type: "technical",
                        title: component.name,
                        codebaseFilePaths: [],
                        description: `${component.highBlockName} / ${component.intermediateBlockName}`,
                        ...(createdAt ? { createdAt } : {}),
                        blueprintComponent: component,
                        blueprintPaperTitle: blueprint.paperTitle,
                        blueprintFileName: blueprint.fileName,
                    },
                });

                if (!nodeIdByComponentId.has(component.id)) {
                    nodeIdByComponentId.set(component.id, nodeId);
                }
            }
        }

        highCursorX += highLayout.highWidth + HIGH_BLOCK_GAP_X;
    }

    for (const component of blueprint.components) {
        const sourceNodeId = nodeIdByComponentId.get(component.id);
        if (!sourceNodeId) continue;

        for (const targetComponentId of component.feedsInto) {
            const targetNodeId = nodeIdByComponentId.get(targetComponentId);
            if (!targetNodeId || targetNodeId === sourceNodeId) continue;

            const key = `${sourceNodeId}->${targetNodeId}`;
            if (edgeKeySet.has(key)) continue;
            edgeKeySet.add(key);

            edges.push({
                id: crypto.randomUUID(),
                source: sourceNodeId,
                target: targetNodeId,
                type: "relation",
                label: "feeds into",
                data: {
                    label: "feeds into",
                    from: "blueprint_component",
                    to: "blueprint_component",
                    ...(createdAt ? { createdAt } : {}),
                },
            });
        }
    }

    return { nodes, edges };
}

/**
 * Isolated components, with no paper around them.
 *
 * This is what a component search drops into the tray: pieces taken from several papers at once,
 * which by definition have no shared box to sit in. They are emitted **parentless**, so the tray can
 * place them wherever the researcher puts them — a component inside a group box cannot be positioned
 * freely, because `compactBlueprintChildren` re-grids a box's children on every resize pass.
 *
 * They keep their real `blueprintFileName` / `blueprintPaperTitle` / `referenceCitation`, unlike the
 * hand-made components the tray's own button creates: a borrowed component has a source, and the
 * markdown report and the timeline both go looking for it.
 *
 * `FeedsInto` is resolved by **`(fileName, ID)`**, never by `ID` alone. Those integers are only
 * unique within one paper, so a drag spanning two papers would otherwise wire a component to a
 * stranger that happened to share its number.
 */
export function buildLooseComponentNodes(
    components: QuerySystemComponentsResult[],
    dropPosition: { x: number; y: number },
    createdAt?: string,
): { nodes: nodeType[]; edges: edgeType[] } {
    const nodes: nodeType[] = [];
    const edges: edgeType[] = [];
    const nodeIdByKey = new Map<string, string>();
    const edgeKeySet = new Set<string>();

    const GAP_PX = 48;
    const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)));
    const pitch = BLUEPRINT_COMPONENT_SIZE_PX + GAP_PX;

    for (let index = 0; index < components.length; index++) {
        const result = components[index];
        const granular = result.granularBlock;
        const component: BlueprintComponent = {
            id: granular.ID,
            name: granular.GranularBlockName,
            feedsInto: Array.isArray(granular.FeedsInto) ? granular.FeedsInto : [],
            description: granular.PaperDescription,
            referenceCitation: granular.ReferenceCitation,
            highBlockName: result.highBlockName,
            intermediateBlockName: result.intermediateBlockName,
        };

        const nodeId = crypto.randomUUID();
        nodes.push({
            id: nodeId,
            position: {
                x: dropPosition.x + ((index % columns) * pitch),
                y: dropPosition.y + (Math.floor(index / columns) * pitch),
            },
            type: "blueprintComponent",
            width: BLUEPRINT_COMPONENT_SIZE_PX,
            height: BLUEPRINT_COMPONENT_SIZE_PX,
            // No `zIndex`: a loose component sits in no box, so there is no nesting order for it to
            // record. The nested builder above sets one because there genuinely is.
            data: {
                label: "blueprint_component",
                type: "technical",
                title: component.name,
                codebaseFilePaths: [],
                description: `${component.highBlockName} / ${component.intermediateBlockName}`,
                ...(createdAt ? { createdAt } : {}),
                blueprintComponent: component,
                blueprintPaperTitle: result.paperTitle,
                blueprintFileName: result.fileName,
            },
        });

        const key = `${result.fileName}#${granular.ID}`;
        if (!nodeIdByKey.has(key)) nodeIdByKey.set(key, nodeId);
    }

    for (const result of components) {
        const sourceNodeId = nodeIdByKey.get(`${result.fileName}#${result.granularBlock.ID}`);
        if (!sourceNodeId) continue;

        for (const targetComponentId of result.granularBlock.FeedsInto ?? []) {
            const targetNodeId = nodeIdByKey.get(`${result.fileName}#${targetComponentId}`);
            if (!targetNodeId || targetNodeId === sourceNodeId) continue;

            const key = `${sourceNodeId}->${targetNodeId}`;
            if (edgeKeySet.has(key)) continue;
            edgeKeySet.add(key);

            edges.push({
                id: crypto.randomUUID(),
                source: sourceNodeId,
                target: targetNodeId,
                type: "relation",
                label: "feeds into",
                data: {
                    label: "feeds into",
                    from: "blueprint_component",
                    to: "blueprint_component",
                    ...(createdAt ? { createdAt } : {}),
                },
            });
        }
    }

    return { nodes, edges };
}
