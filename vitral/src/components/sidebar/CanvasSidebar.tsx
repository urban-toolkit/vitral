import { memo } from "react";
import styles from "./CanvasSidebar.module.css";

export type CanvasViewMode = "explore" | "evolution";

type CanvasSidebarProps = {
    collapsed: boolean;
    onToggleCollapsed: () => void;
    viewMode: CanvasViewMode;
    onViewModeChange: (mode: CanvasViewMode) => void;
};

export const CanvasSidebar = memo(function CanvasSidebar({
    collapsed,
    onToggleCollapsed,
    viewMode,
    onViewModeChange
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
                    </>
                )}
            </div>

            <button type="button" className={styles.toggle} onClick={onToggleCollapsed}>
                {collapsed ? ">" : "<"}
            </button>
        </aside>
    );
});

