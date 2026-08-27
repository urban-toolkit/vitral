
import type { QuerySystemPapersResult, SystemPaper } from "@/api/stateApi";
import styles from "./SystemPaperThumbnail.module.css";

/**
 * A whole system paper drawn small: high blocks, the intermediate blocks inside them, and a circle
 * per component. Moved out of `CanvasSidebar` when the blueprint tray took over the search, because
 * both the results list and its hover preview need it and 230 lines of layout arithmetic should not
 * exist twice.
 *
 * It is a *picture*, not an interactive miniature: the point is to recognise the shape of a system
 * before dragging it in, which a list of block names cannot do.
 */

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

export type PaperTooltipState = {
    x: number;
    y: number;
    size: number;
    result: QuerySystemPapersResult;
};

/**
 * The hover preview: a floating square holding the whole paper, sized to fit it and flipped to stay
 * on screen.
 *
 * A `position: fixed` element rather than a popover inside the list row, because the row is inside a
 * scrolling panel and the preview is up to 860px square — it has to escape both.
 */
export function SystemPaperHoverPreview({ result, x, y, size }: {
    result: QuerySystemPapersResult;
    x: number;
    y: number;
    size: number;
}) {
    return (
        <div
            className={styles.tooltip}
            style={{ width: `${size}px`, height: `${size}px`, left: `${x}px`, top: `${y}px` }}
        >
            <SystemPaperThumbnail result={result} fillContainer />
        </div>
    );
}

export { SystemPaperThumbnail };
