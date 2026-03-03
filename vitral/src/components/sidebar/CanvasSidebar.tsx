import { memo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { cardLabel } from "@/config/types";
import type { QuerySystemPapersResult, SystemPaper } from "@/api/stateApi";
import { CARD_LABEL_COLORS, CARD_LABEL_ICONS, CARD_LABELS } from "@/components/cards/cardVisuals";
import { BLUEPRINT_DRAG_MIME, buildBlueprintDragPayload } from "@/components/blueprint/blueprintDnD";
import styles from "./CanvasSidebar.module.css";

export type CanvasViewMode = "explore" | "evolution";

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

function getHighBlockWeight(highBlock: SystemPaper["HighBlocks"][number]): number {
    const granularCount = highBlock.IntermediateBlocks.reduce(
        (sum, intermediate) => sum + intermediate.GranularBlocks.length,
        0,
    );
    return Math.max(1, granularCount + highBlock.IntermediateBlocks.length);
}

function SystemPaperThumbnail({
    result,
    fillContainer = false,
}: {
    result: QuerySystemPapersResult;
    fillContainer?: boolean;
}) {
    const paper = result.paper;
    const cardClassName = fillContainer
        ? `${styles.systemPaperCard} ${styles.systemPaperCardFill}`
        : styles.systemPaperCard;

    return (
        <div className={cardClassName} role="img" aria-label={`System paper thumbnail for ${result.paperTitle}`}>
            <div className={styles.paperRoot}>
                <div className={styles.paperTitleText} title={paper.PaperTitle}>
                    {truncateLabel(paper.PaperTitle, 72)}
                </div>

                <div className={styles.paperHighBlocks}>
                    {paper.HighBlocks.map((highBlock, highIndex) => (
                        <section
                            key={`${highBlock.HighBlockName}-${highIndex}`}
                            className={styles.paperHighBox}
                            style={{ flexGrow: getHighBlockWeight(highBlock) }}
                        >
                            <div className={styles.paperHighText} title={highBlock.HighBlockName}>
                                {truncateLabel(highBlock.HighBlockName, 80)}
                            </div>

                            <div
                                className={styles.paperIntermediateGrid}
                                style={{
                                    gridTemplateColumns: `repeat(${getIntermediateColumns(highBlock.IntermediateBlocks.length)}, minmax(0, 1fr))`,
                                }}
                            >
                                {highBlock.IntermediateBlocks.map((intermediateBlock, intermediateIndex) => (
                                    <article
                                        key={`${highIndex}-${intermediateBlock.IntermediateBlockName}-${intermediateIndex}`}
                                        className={styles.paperIntermediateBox}
                                    >
                                        <div className={styles.paperIntermediateText} title={intermediateBlock.IntermediateBlockName}>
                                            {truncateLabel(intermediateBlock.IntermediateBlockName, 48)}
                                        </div>

                                        <div className={styles.paperGranularList}>
                                            {intermediateBlock.GranularBlocks.map((granularBlock, granularIndex) => {
                                                const labelLines = splitCircleLabel(granularBlock.GranularBlockName, 9, 3);
                                                return (
                                                    <div
                                                        key={`${highIndex}-${intermediateIndex}-${granularIndex}-${granularBlock.ID}`}
                                                        className={styles.paperGranularCircle}
                                                        title={granularBlock.GranularBlockName}
                                                    >
                                                        {labelLines.map((line, lineIndex) => (
                                                            <span
                                                                key={`${granularBlock.ID}-${lineIndex}`}
                                                                className={styles.paperGranularLine}
                                                            >
                                                                {line}
                                                            </span>
                                                        ))}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}

type CanvasSidebarProps = {
    collapsed: boolean;
    onToggleCollapsed: () => void;
    viewMode: CanvasViewMode;
    onViewModeChange: (mode: CanvasViewMode) => void;
    selectedLabels: cardLabel[];
    onToggleLabel: (label: cardLabel) => void;
    queryValue: string;
    onQueryValueChange: (value: string) => void;
    onQuerySubmit: () => void;
    onQueryClear: () => void;
    queryLoading: boolean;
    queryError: string | null;
    queryResultCount: number | null;
    systemPaperResults: QuerySystemPapersResult[];
    systemPapersLoading: boolean;
    systemPapersError: string | null;
    onSystemPapersRefresh: () => void;
};

type PaperTooltipState = {
    x: number;
    y: number;
    size: number;
    result: QuerySystemPapersResult;
};

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

export const CanvasSidebar = memo(function CanvasSidebar({
    collapsed,
    onToggleCollapsed,
    viewMode,
    onViewModeChange,
    selectedLabels,
    onToggleLabel,
    queryValue,
    onQueryValueChange,
    onQuerySubmit,
    onQueryClear,
    queryLoading,
    queryError,
    queryResultCount,
    systemPaperResults,
    systemPapersLoading,
    systemPapersError,
    onSystemPapersRefresh,
}: CanvasSidebarProps) {
    const [paperTooltip, setPaperTooltip] = useState<PaperTooltipState | null>(null);

    return (
        <aside className={styles.root}>
            <div className={collapsed ? styles.collapsedPanel : styles.panel}>
                {!collapsed && (
                    <>
                        <h3 className={styles.title}>Views</h3>

                        <p className={styles.sectionLabel}>View mode</p>
                        <div className={styles.group}>
                            <button
                                type="button"
                                className={`${styles.option} ${viewMode === "explore" ? styles.optionActive : ""}`}
                                onClick={() => onViewModeChange("explore")}
                            >
                                Explore view
                            </button>
                            <button
                                type="button"
                                className={`${styles.option} ${viewMode === "evolution" ? styles.optionActive : ""}`}
                                onClick={() => onViewModeChange("evolution")}
                            >
                                Evolution view
                            </button>
                        </div>

                        <p className={styles.helper}>
                            Evolution view aligns trees on a horizontal timeline using each node timestamp.
                        </p>

                        <p className={styles.sectionLabel}>Card types</p>
                        <div className={styles.labelGrid}>
                            {CARD_LABELS.map((label) => {
                                const selected = selectedLabels.includes(label);
                                const icon = CARD_LABEL_ICONS[label];
                                const circleStyle = {
                                    backgroundColor: selected ? CARD_LABEL_COLORS[label] : "transparent",
                                    borderColor: CARD_LABEL_COLORS[label],
                                };

                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        className={`${styles.labelOption} ${selected ? styles.labelOptionActive : ""}`}
                                        onClick={() => onToggleLabel(label)}
                                        title={label}
                                    >
                                        <span className={styles.labelCircle} style={circleStyle}>
                                            <FontAwesomeIcon icon={icon} />
                                        </span>
                                        <span className={styles.labelText}>{label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <p className={styles.sectionLabel}>Query</p>
                        <form
                            className={styles.queryForm}
                            onSubmit={(event) => {
                                event.preventDefault();
                                onQuerySubmit();
                            }}
                        >
                            <input
                                type="text"
                                className={styles.queryInput}
                                placeholder="Find cards with natural language..."
                                value={queryValue}
                                onChange={(event) => onQueryValueChange(event.target.value)}
                            />
                            <div className={styles.queryActions}>
                                <button
                                    type="submit"
                                    className={styles.queryButton}
                                    disabled={queryLoading || queryValue.trim().length === 0}
                                >
                                    {queryLoading ? "Searching..." : "Search"}
                                </button>
                                <button
                                    type="button"
                                    className={styles.queryClear}
                                    onClick={onQueryClear}
                                    disabled={queryLoading}
                                >
                                    Clear
                                </button>
                            </div>
                        </form>
                        {queryError ? (
                            <p className={styles.queryError}>{queryError}</p>
                        ) : null}
                        {queryResultCount !== null ? (
                            <p className={styles.queryMeta}>Showing {queryResultCount} matching cards.</p>
                        ) : null}

                        <p className={styles.sectionLabel}>System papers</p>
                        <div className={styles.systemPaperActions}>
                            <button
                                type="button"
                                className={styles.systemPaperRefresh}
                                onClick={onSystemPapersRefresh}
                                disabled={systemPapersLoading}
                            >
                                {systemPapersLoading ? "Refreshing..." : "Refresh"}
                            </button>
                        </div>
                        {systemPapersError ? (
                            <p className={styles.queryError}>{systemPapersError}</p>
                        ) : null}
                        {systemPaperResults.length > 0 ? (
                            <ul className={styles.systemPaperList}>
                                {systemPaperResults.map((result) => (
                                    <li
                                        key={result.fileName}
                                        className={`${styles.systemPaperItem} ${styles.systemPaperTitleItem}`}
                                        draggable
                                        onMouseEnter={(event) => {
                                            const size = estimateTooltipSize(result);
                                            const position = resolveTooltipPosition(event.clientX, event.clientY, size);
                                            setPaperTooltip({
                                                result,
                                                size,
                                                x: position.x,
                                                y: position.y,
                                            });
                                        }}
                                        onMouseMove={(event) => {
                                            const size = estimateTooltipSize(result);
                                            const position = resolveTooltipPosition(event.clientX, event.clientY, size);
                                            setPaperTooltip((prev) => (prev ? {
                                                ...prev,
                                                size,
                                                x: position.x,
                                                y: position.y,
                                            } : prev));
                                        }}
                                        onMouseLeave={() => {
                                            setPaperTooltip(null);
                                        }}
                                        onDragStart={(event) => {
                                            setPaperTooltip(null);
                                            event.dataTransfer.effectAllowed = "copy";
                                            event.dataTransfer.setData(
                                                BLUEPRINT_DRAG_MIME,
                                                JSON.stringify(buildBlueprintDragPayload(result)),
                                            );
                                            event.dataTransfer.setData("text/plain", result.paperTitle);
                                        }}
                                        onDragEnd={() => {
                                            setPaperTooltip(null);
                                        }}
                                    >
                                        <span className={styles.systemPaperTitleText}>
                                            {result.paperTitle}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={styles.systemPaperEmpty}>No results yet.</p>
                        )}
                    </>
                )}
            </div>

            {paperTooltip ? (
                <div
                    className={styles.systemPaperTooltip}
                    style={{
                        width: `${paperTooltip.size}px`,
                        height: `${paperTooltip.size}px`,
                        left: `${paperTooltip.x}px`,
                        top: `${paperTooltip.y}px`,
                    }}
                >
                    <SystemPaperThumbnail result={paperTooltip.result} fillContainer />
                </div>
            ) : null}

            <button type="button" className={styles.toggle} onClick={onToggleCollapsed}>
                {collapsed ? ">" : "<"}
            </button>
        </aside>
    );
});
