import { memo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { cardLabel } from "@/config/types";
import { CARD_LABEL_COLORS, CARD_LABEL_ICONS, CARD_LABELS } from "@/components/cards/cardVisuals";
import styles from "./CanvasSidebar.module.css";

export type CanvasViewMode = "explore" | "evolution";

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
};

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
}: CanvasSidebarProps) {
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
                    </>
                )}
            </div>

            <button type="button" className={styles.toggle} onClick={onToggleCollapsed}>
                {collapsed ? ">" : "<"}
            </button>
        </aside>
    );
});

