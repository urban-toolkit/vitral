import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faChevronDown,
    faChevronRight,
    faCircleInfo,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
    BLUEPRINT_COMPONENTS_DRAG_MIME,
    BLUEPRINT_DRAG_MIME,
    buildBlueprintComponentsDragPayload,
    buildBlueprintDragPayload,
} from "@/components/blueprint/blueprintDnD";
import { SystemPaperHoverPreview } from "@/components/blueprint/SystemPaperThumbnail";
import { useSystemPaperPreview } from "@/components/blueprint/useSystemPaperPreview";
import type { BlueprintSearch } from "@/components/blueprint/useBlueprintSearch";
import styles from "./BlueprintSearchPanel.module.css";

/**
 * The two halves of the literature search, as two components over one `useBlueprintSearch`.
 *
 * They were one panel stacked above the tray's graph, which meant every search shortened the
 * surface the results were about to be dragged into — the list and the canvas competing for the
 * same height budget. Splitting them lets the tray keep the buttons where the graph starts and put
 * the results in a column beside it, so a search widens the tray instead of squeezing it.
 */

function truncate(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

/** The two search buttons. Sits above the tray canvas, at its full width. */
export function BlueprintSearchActions({
    search,
    disabled = false,
}: {
    search: BlueprintSearch;
    disabled?: boolean;
}) {
    const { loading, mode, selectedCount, runBlueprintSearch, runComponentSearch } = search;

    return (
        <div className={styles.actions}>
            <button
                type="button"
                className={`${styles.searchButton} ${mode === "paper" ? styles.searchButtonActive : ""}`}
                onClick={runBlueprintSearch}
                disabled={disabled || loading}
                title="Rank whole systems from the literature against every requirement in the project"
            >
                Find blueprints
            </button>
            <button
                type="button"
                className={`${styles.searchButton} ${mode === "component" ? styles.searchButtonActive : ""}`}
                onClick={runComponentSearch}
                disabled={disabled || loading || selectedCount === 0}
                title={selectedCount === 0
                    ? "Select one or more requirement cards on the canvas first"
                    : `Find individual components answering the ${selectedCount} selected requirement${selectedCount === 1 ? "" : "s"}`}
            >
                {selectedCount > 0 ? `Find components (${selectedCount})` : "Find components"}
            </button>
            <span className={styles.info}>
                <FontAwesomeIcon icon={faCircleInfo} />
                <span className={styles.infoTooltip}>
                    Blueprints rank whole systems against every requirement. Components search the
                    blocks inside every system, scoped to the requirement cards you have selected
                    on the canvas. Drag either into the tray.
                </span>
            </span>
        </div>
    );
}

/**
 * The result list, as its own column to the right of the tray canvas.
 *
 * Renders nothing at all until a search has been run, so the tray is only as wide as the graph
 * until there is something to put beside it.
 */
export function BlueprintSearchResults({ search }: { search: BlueprintSearch }) {
    const {
        mode,
        loading,
        error,
        paperResults,
        componentResults,
        expanded,
        setExpanded,
        dismiss,
    } = search;
    const { preview, track, clearPreview } = useSystemPaperPreview();

    if (mode === null) return null;

    return (
        <div className={styles.results}>
            <div className={styles.resultsHeader}>
                <span className={styles.resultsTitle}>
                    {mode === "paper" ? "Blueprints" : "Components"}
                </span>
                <button
                    type="button"
                    className={styles.resultsClose}
                    onClick={dismiss}
                    title="Close the results"
                    aria-label="Close the results"
                >
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            </div>

            {loading ? <p className={styles.hint}>Searching...</p> : null}
            {error ? <p className={styles.error}>{error}</p> : null}

            {!loading && mode === "paper" && paperResults.length > 0 ? (
                <ul className={styles.list}>
                    {paperResults.map((result) => {
                        const isOpen = expanded === result.fileName;
                        const components = result.paper.HighBlocks.flatMap((high) =>
                            high.IntermediateBlocks.flatMap((intermediate) =>
                                intermediate.GranularBlocks.map((granular) => ({
                                    fileName: result.fileName,
                                    paperTitle: result.paperTitle,
                                    year: result.year,
                                    highBlockName: high.HighBlockName,
                                    intermediateBlockName: intermediate.IntermediateBlockName,
                                    score: 0,
                                    coverage: 0,
                                    matchedTerms: [],
                                    granularBlock: granular,
                                })),
                            ),
                        );

                        return (
                            <li key={result.fileName} className={styles.paperItem}>
                                <div
                                    className={styles.paperRow}
                                    draggable
                                    {...track(result)}
                                    onDragStart={(event) => {
                                        clearPreview();
                                        event.dataTransfer.effectAllowed = "copy";
                                        event.dataTransfer.setData(
                                            BLUEPRINT_DRAG_MIME,
                                            JSON.stringify(buildBlueprintDragPayload(result)),
                                        );
                                        event.dataTransfer.setData("text/plain", result.paperTitle);
                                    }}
                                    onDragEnd={clearPreview}
                                >
                                    {/* Expanding is how pieces are taken without the whole paper.
                                        A button rather than a click on the row, because the row is
                                        the drag handle for the paper itself. */}
                                    <button
                                        type="button"
                                        className={styles.expand}
                                        aria-label={isOpen ? "Hide components" : "Show components"}
                                        aria-expanded={isOpen}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setExpanded(isOpen ? null : result.fileName);
                                        }}
                                    >
                                        <FontAwesomeIcon icon={isOpen ? faChevronDown : faChevronRight} />
                                    </button>
                                    <span className={styles.paperTitle}>{result.paperTitle}</span>
                                    {result.year > 0 ? (
                                        <span className={styles.year}>{result.year}</span>
                                    ) : null}
                                </div>

                                {isOpen ? (
                                    <ul className={styles.componentSubList}>
                                        {components.map((component) => (
                                            <li
                                                key={`${component.fileName}#${component.granularBlock.ID}`}
                                                className={styles.componentRow}
                                                draggable
                                                title={component.granularBlock.PaperDescription}
                                                onDragStart={(event) => {
                                                    event.stopPropagation();
                                                    event.dataTransfer.effectAllowed = "copy";
                                                    event.dataTransfer.setData(
                                                        BLUEPRINT_COMPONENTS_DRAG_MIME,
                                                        JSON.stringify(
                                                            buildBlueprintComponentsDragPayload([component]),
                                                        ),
                                                    );
                                                    event.dataTransfer.setData(
                                                        "text/plain",
                                                        component.granularBlock.GranularBlockName,
                                                    );
                                                }}
                                            >
                                                <span className={styles.componentName}>
                                                    {component.granularBlock.GranularBlockName}
                                                </span>
                                                <span className={styles.componentPath}>
                                                    {truncate(component.highBlockName, 22)}
                                                    {" / "}
                                                    {truncate(component.intermediateBlockName, 22)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            {!loading && mode === "component" && componentResults.length > 0 ? (
                <ul className={styles.list}>
                    {componentResults.map((result) => (
                        <li
                            key={`${result.fileName}#${result.granularBlock.ID}`}
                            className={styles.componentRow}
                            draggable
                            title={result.granularBlock.PaperDescription}
                            onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData(
                                    BLUEPRINT_COMPONENTS_DRAG_MIME,
                                    JSON.stringify(buildBlueprintComponentsDragPayload([result])),
                                );
                                event.dataTransfer.setData(
                                    "text/plain",
                                    result.granularBlock.GranularBlockName,
                                );
                            }}
                        >
                            <span className={styles.componentName}>
                                {result.granularBlock.GranularBlockName}
                            </span>
                            <span className={styles.componentPath}>
                                {truncate(result.highBlockName, 20)}
                                {" / "}
                                {truncate(result.intermediateBlockName, 20)}
                            </span>
                            {/* The source, because a borrowed component is a citation. */}
                            <span className={styles.componentSource} title={result.paperTitle}>
                                {truncate(result.paperTitle, 52)}
                                {result.year > 0 ? ` (${result.year})` : ""}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {preview ? (
                <SystemPaperHoverPreview
                    result={preview.result}
                    x={preview.x}
                    y={preview.y}
                    size={preview.size}
                />
            ) : null}
        </div>
    );
}
