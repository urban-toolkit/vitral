import { useCallback, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronRight, faCircleInfo } from "@fortawesome/free-solid-svg-icons";

import {
    querySystemComponents,
    querySystemPapers,
    type QuerySystemComponentsResult,
    type QuerySystemPapersResult,
    type SystemPaperQueryCard,
} from "@/api/stateApi";
import {
    BLUEPRINT_COMPONENTS_DRAG_MIME,
    BLUEPRINT_DRAG_MIME,
    buildBlueprintComponentsDragPayload,
    buildBlueprintDragPayload,
} from "@/components/blueprint/blueprintDnD";
import { SystemPaperHoverPreview } from "@/components/blueprint/SystemPaperThumbnail";
import { useSystemPaperPreview } from "@/components/blueprint/useSystemPaperPreview";
import styles from "./BlueprintSearchPanel.module.css";

/**
 * Searching the Visual Analytics literature, at two granularities.
 *
 * The two modes answer different questions and are deliberately two buttons rather than a toggle,
 * because the input differs as much as the output:
 *
 * - **Blueprints** takes *every* requirement in the project and asks which published system covers
 *   them. The answer is a whole paper, and what you do with it is drag its structure into the tray.
 * - **Components** takes the requirements the researcher **selected on the canvas** and asks which
 *   individual blocks, from anywhere in the corpus, answer those. The answer is a blended list from
 *   several papers, and what you do with it is take the pieces.
 *
 * A toggle would imply one search with a display option. It is two searches, over two corpora, with
 * two different scopes — and the selection requirement is only meaningful for one of them.
 */

type BlueprintSearchPanelProps = {
    /** Every live, relevant requirement card. Scopes the blueprint search. */
    requirementCards: SystemPaperQueryCard[];
    /** The requirement cards selected on the canvas. Scopes the component search. */
    selectedRequirementCards: SystemPaperQueryCard[];
    disabled?: boolean;
};

function truncate(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

type Mode = "paper" | "component";

export function BlueprintSearchPanel({
    requirementCards,
    selectedRequirementCards,
    disabled = false,
}: BlueprintSearchPanelProps) {
    const [mode, setMode] = useState<Mode | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paperResults, setPaperResults] = useState<QuerySystemPapersResult[]>([]);
    const [componentResults, setComponentResults] = useState<QuerySystemComponentsResult[]>([]);
    const [expanded, setExpanded] = useState<string | null>(null);
    const { preview, track, clearPreview } = useSystemPaperPreview();

    const selectedCount = selectedRequirementCards.length;

    const runBlueprintSearch = useCallback(() => {
        if (requirementCards.length === 0) {
            setMode("paper");
            setPaperResults([]);
            setError("Add at least one requirement card first.");
            return;
        }

        setMode("paper");
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const response = await querySystemPapers({ cards: requirementCards, limit: 5 });
                setPaperResults(response.results);
                if (response.results.length === 0) {
                    setError("No system in the corpus matched these requirements.");
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Search failed.");
                setPaperResults([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [requirementCards]);

    const runComponentSearch = useCallback(() => {
        if (selectedRequirementCards.length === 0) return;

        setMode("component");
        setLoading(true);
        setError(null);
        void (async () => {
            try {
                const response = await querySystemComponents({
                    cards: selectedRequirementCards,
                    limit: 12,
                });
                setComponentResults(response.results);
                if (response.results.length === 0) {
                    setError("No component in the corpus matched the selected requirements.");
                }
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Search failed.");
                setComponentResults([]);
            } finally {
                setLoading(false);
            }
        })();
    }, [selectedRequirementCards]);

    return (
        <div className={styles.root}>
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
