import { useState } from "react";

import type { QuerySystemPapersResult } from "@/api/stateApi";
import type { PaperTooltipState } from "@/components/blueprint/SystemPaperThumbnail";

const TOOLTIP_OFFSET_PX = 14;
const TOOLTIP_VIEWPORT_MARGIN_PX = 12;
const TOOLTIP_BASE_SIZE_PX = 500;
const TOOLTIP_MAX_SIZE_PX = 860;

function estimateTooltipSize(result: QuerySystemPapersResult): number {
    const paper = result.paper;

    const OUTER_PADDING = 8;
    const ROOT_GAP = 8;
    const HIGH_GAP = 8;
    const HIGH_PADDING = 6;
    const INTERMEDIATE_GAP = 6;
    const INTERMEDIATE_PADDING = 6;
    const GRANULAR_AREA_PADDING_BOTTOM = 6;
    const CIRCLE_SIZE = 64;
    const CIRCLE_GAP = 8;
    const TITLE_HEIGHT = 24;
    const HIGH_TITLE_HEIGHT = 16;
    const INTERMEDIATE_TITLE_HEIGHT = 14;

    const getColumns = (count: number) => {
        if (count <= 1) return 1;
        if (count <= 4) return 2;
        if (count <= 9) return 3;
        return 4;
    };

    const requiredHeightForWidth = (size: number): number => {
        const rootInnerWidth = size - (OUTER_PADDING * 2);
        const highInnerWidth = rootInnerWidth - (HIGH_PADDING * 2);

        let totalHighHeight = 0;

        for (const highBlock of paper.HighBlocks) {
            const intermediates = highBlock.IntermediateBlocks;
            const cols = getColumns(intermediates.length);
            const colGapCount = Math.max(0, cols - 1);
            const intermediateWidth = (
                highInnerWidth -
                (INTERMEDIATE_GAP * colGapCount)
            ) / Math.max(1, cols);

            const circleAreaWidth = intermediateWidth - (INTERMEDIATE_PADDING * 2);
            const circlesPerRow = Math.max(
                1,
                Math.floor((circleAreaWidth + CIRCLE_GAP) / (CIRCLE_SIZE + CIRCLE_GAP)),
            );

            const itemHeights = intermediates.map((intermediate) => {
                const circleCount = intermediate.GranularBlocks.length;
                const rows = Math.max(1, Math.ceil(circleCount / circlesPerRow));
                const circlesHeight = (rows * CIRCLE_SIZE) + (Math.max(0, rows - 1) * CIRCLE_GAP);
                return (
                    (INTERMEDIATE_PADDING * 2) +
                    INTERMEDIATE_TITLE_HEIGHT +
                    6 +
                    circlesHeight +
                    GRANULAR_AREA_PADDING_BOTTOM
                );
            });

            const rowCount = Math.max(1, Math.ceil(intermediates.length / cols));
            let gridHeight = 0;
            for (let row = 0; row < rowCount; row++) {
                const rowStart = row * cols;
                const rowItems = itemHeights.slice(rowStart, rowStart + cols);
                const rowMax = rowItems.length > 0 ? Math.max(...rowItems) : 0;
                gridHeight += rowMax;
            }
            gridHeight += Math.max(0, rowCount - 1) * INTERMEDIATE_GAP;

            const highHeight = (
                (HIGH_PADDING * 2) +
                HIGH_TITLE_HEIGHT +
                6 +
                gridHeight
            );
            totalHighHeight += highHeight;
        }

        totalHighHeight += Math.max(0, paper.HighBlocks.length - 1) * HIGH_GAP;

        return (
            (OUTER_PADDING * 2) +
            TITLE_HEIGHT +
            ROOT_GAP +
            totalHighHeight
        );
    };

    let size = TOOLTIP_BASE_SIZE_PX;
    for (let i = 0; i < 20; i++) {
        const needed = requiredHeightForWidth(size);
        if (needed <= size) break;
        size = Math.min(TOOLTIP_MAX_SIZE_PX, Math.ceil(needed));
    }

    return Math.max(TOOLTIP_BASE_SIZE_PX, Math.min(size, TOOLTIP_MAX_SIZE_PX));
}

function resolveTooltipPosition(cursorX: number, cursorY: number, size: number): { x: number; y: number } {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = cursorX + TOOLTIP_OFFSET_PX;
    let y = cursorY + TOOLTIP_OFFSET_PX;

    if (x + size + TOOLTIP_VIEWPORT_MARGIN_PX > viewportWidth) {
        x = cursorX - size - TOOLTIP_OFFSET_PX;
    }

    if (y + size + TOOLTIP_VIEWPORT_MARGIN_PX > viewportHeight) {
        y = cursorY - size - TOOLTIP_OFFSET_PX;
    }

    x = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, Math.min(x, viewportWidth - size - TOOLTIP_VIEWPORT_MARGIN_PX));
    y = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, Math.min(y, viewportHeight - size - TOOLTIP_VIEWPORT_MARGIN_PX));

    return { x, y };
}

/**
 * Hover state for a list of paper results, and the two handlers that keep it pinned to the cursor.
 *
 * Kept as a hook so the tray's results list stays about results: every consumer needs the same
 * enter/move/leave triple and the same "drop it the moment a drag starts" rule, because a preview
 * left up during a drag covers the thing being dragged onto.
 */
export function useSystemPaperPreview() {
    const [preview, setPreview] = useState<PaperTooltipState | null>(null);

    const track = (result: QuerySystemPapersResult) => ({
        onMouseEnter: (event: { clientX: number; clientY: number }) => {
            const size = estimateTooltipSize(result);
            const position = resolveTooltipPosition(event.clientX, event.clientY, size);
            setPreview({ result, size, x: position.x, y: position.y });
        },
        onMouseMove: (event: { clientX: number; clientY: number }) => {
            const size = estimateTooltipSize(result);
            const position = resolveTooltipPosition(event.clientX, event.clientY, size);
            setPreview((previous) => (previous ? { ...previous, size, ...position } : previous));
        },
        onMouseLeave: () => setPreview(null),
    });

    return { preview, track, clearPreview: () => setPreview(null) };
}

