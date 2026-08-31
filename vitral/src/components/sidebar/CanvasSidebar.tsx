import { memo, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight, faDesktop, faDownload, faGear, faHouse, faPenNib, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import type { cardLabel } from "@/config/types";
import { CARD_LABEL_COLORS, CARD_LABEL_ICONS, CARD_LABELS } from "@/components/cards/cardVisuals";
import styles from "./CanvasSidebar.module.css";

/** Matches the border of a blueprint component node, so the filter reads as the thing it hides. */
const BLUEPRINT_COMPONENT_FILTER_COLOR = "rgba(91, 186, 214, 0.70)";
/** Matches `.modelDerivedBadge` on the card, so the chip and the badge read as one marker. */
const MODEL_DERIVED_FILTER_COLOR = "rgba(146, 118, 200, 0.70)";
/** Matches `.authored`'s inset bar on the card, for the same reason. */
const AUTHORED_FILTER_COLOR = "rgba(176, 96, 24, 0.70)";

function truncateLabel(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

type CanvasSidebarProps = {
    title: string;
    onSetTitle: (newTitle: string) => void;
    onGoHome?: () => void;
    onOpenSettings?: () => void;
    onExportProject?: () => void;
    exportingProject?: boolean;
    onExportMarkdown?: () => void;
    exportingMarkdown?: boolean;
    bottomOffsetPx?: number;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    blueprintComponentsVisible: boolean;
    onToggleBlueprintComponents: () => void;
    modelDerivedVisible: boolean;
    onToggleModelDerived: () => void;
    authoredVisible: boolean;
    onToggleAuthored: () => void;
    selectedLabels: cardLabel[];
    onToggleLabel: (label: cardLabel) => void;
};

export const CanvasSidebar = memo(function CanvasSidebar({
    title,
    onSetTitle,
    onGoHome,
    onOpenSettings,
    onExportProject,
    exportingProject = false,
    onExportMarkdown,
    exportingMarkdown = false,
    bottomOffsetPx = 0,
    collapsed,
    onToggleCollapsed,
    blueprintComponentsVisible,
    onToggleBlueprintComponents,
    modelDerivedVisible,
    onToggleModelDerived,
    authoredVisible,
    onToggleAuthored,
    selectedLabels,
    onToggleLabel,
}: CanvasSidebarProps) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [draftTitle, setDraftTitle] = useState(title);

    useEffect(() => {
        setDraftTitle(title);
    }, [title]);

    const commitTitleEdit = () => {
        setEditingTitle(false);
        const nextTitle = draftTitle.trim() || title || "Untitled";
        setDraftTitle(nextTitle);
        if (nextTitle !== title) {
            onSetTitle(nextTitle);
        }
    };

    /**
     * A ceiling, not a height. The card is as tall as the filters make it; this only stops it
     * running off the bottom of a short viewport, and `.panel` scrolls when it would.
     *
     * `32px` is the 16px inset at the top plus the same clearance at the bottom, so the card never
     * touches either edge, and `bottomOffsetPx` keeps it clear of the timeline dock.
     */
    const sidebarMaxHeight = `calc(100vh - ${32 + Math.max(0, bottomOffsetPx)}px)`;

    return (
        <aside
            className={`${styles.root} ${collapsed ? styles.rootCollapsed : ""}`}
            style={collapsed ? undefined : { maxHeight: sidebarMaxHeight }}
        >
            <div className={collapsed ? styles.panelCollapsed : styles.panel}>
                <div className={styles.projectHeader}>
                    {editingTitle ? (
                        <input
                            type="text"
                            className={styles.projectTitleInput}
                            value={draftTitle}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            onBlur={commitTitleEdit}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    commitTitleEdit();
                                }
                                if (event.key === "Escape") {
                                    setEditingTitle(false);
                                    setDraftTitle(title);
                                }
                            }}
                            autoFocus
                        />
                    ) : (
                        <button
                            type="button"
                            className={styles.projectTitleButton}
                            onClick={() => {
                                if (collapsed) return;
                                setEditingTitle(true);
                            }}
                            title={draftTitle}
                        >
                            <span className={styles.projectTitleText}>
                                {truncateLabel(draftTitle || "Untitled", 25)}
                            </span>
                        </button>
                    )}

                    <div className={styles.projectHeaderActions}>
                        {onGoHome ? (
                            <button
                                type="button"
                                className={styles.homeButton}
                                onClick={onGoHome}
                                title="Back to projects"
                                aria-label="Back to projects"
                            >
                                <FontAwesomeIcon icon={faHouse} />
                            </button>
                        ) : null}
                        {onOpenSettings ? (
                            <button
                                type="button"
                                className={styles.settingsButton}
                                onClick={onOpenSettings}
                                title="Project settings"
                                aria-label="Project settings"
                            >
                                <FontAwesomeIcon icon={faGear} />
                            </button>
                        ) : null}
                        {onExportProject ? (
                            <button
                                type="button"
                                className={styles.exportHeaderButton}
                                onClick={onExportProject}
                                title="Export project (.vi)"
                                aria-label="Export project (.vi)"
                                disabled={exportingProject}
                            >
                                {exportingProject ? "..." : <FontAwesomeIcon icon={faDownload} />}
                            </button>
                        ) : null}
                        {onExportMarkdown ? (
                            <button
                                type="button"
                                className={styles.exportHeaderButton}
                                onClick={onExportMarkdown}
                                title="Export markdown report"
                                aria-label="Export markdown report"
                                disabled={exportingMarkdown}
                            >
                                {exportingMarkdown ? "..." : "MD"}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className={styles.toggleHeaderButton}
                            onClick={onToggleCollapsed}
                            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                        >
                            <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronLeft} />
                        </button>
                    </div>
                </div>

                {!collapsed && (
                    <>
                        <p className={styles.projectSubtitle}>
                            Design studies are <span className={styles.socialTag}>technical</span> and <span className={styles.technicalTag}>social</span>
                        </p>

                        <h3 className={styles.title}>Filters</h3>
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

                            <button
                                type="button"
                                className={`${styles.labelOption} ${blueprintComponentsVisible ? styles.labelOptionActive : ""}`}
                                onClick={onToggleBlueprintComponents}
                                title="the blueprint components answering a requirement, drawn beside it"
                            >
                                <span
                                    className={styles.labelCircle}
                                    style={{
                                        backgroundColor: blueprintComponentsVisible
                                            ? BLUEPRINT_COMPONENT_FILTER_COLOR
                                            : "transparent",
                                        borderColor: BLUEPRINT_COMPONENT_FILTER_COLOR,
                                    }}
                                >
                                    <FontAwesomeIcon icon={faDesktop} />
                                </span>
                                <span className={styles.labelText}>answers</span>
                            </button>

                            {/* Not a kind of card but a question about where cards came from, which
                                is why it sits with the filters rather than in a menu: turning it off
                                leaves only what the team wrote and collected by hand. */}
                            <button
                                type="button"
                                className={`${styles.labelOption} ${modelDerivedVisible ? styles.labelOptionActive : ""}`}
                                onClick={onToggleModelDerived}
                                title="cards proposed by the model from a source document"
                            >
                                <span
                                    className={styles.labelCircle}
                                    style={{
                                        backgroundColor: modelDerivedVisible
                                            ? MODEL_DERIVED_FILTER_COLOR
                                            : "transparent",
                                        borderColor: MODEL_DERIVED_FILTER_COLOR,
                                    }}
                                >
                                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                                </span>
                                <span className={styles.labelText}>AI cards</span>
                            </button>

                            {/* The other side of the same question. With this off the canvas shows
                                only what the model proposed, which is what it looked like before
                                anyone read it. */}
                            <button
                                type="button"
                                className={`${styles.labelOption} ${authoredVisible ? styles.labelOptionActive : ""}`}
                                onClick={onToggleAuthored}
                                title="cards a person wrote, dropped, or drew by hand"
                            >
                                <span
                                    className={styles.labelCircle}
                                    style={{
                                        backgroundColor: authoredVisible
                                            ? AUTHORED_FILTER_COLOR
                                            : "transparent",
                                        borderColor: AUTHORED_FILTER_COLOR,
                                    }}
                                >
                                    <FontAwesomeIcon icon={faPenNib} />
                                </span>
                                <span className={styles.labelText}>your cards</span>
                            </button>
                        </div>

                    </>
                )}
            </div>

        </aside>
    );
});
