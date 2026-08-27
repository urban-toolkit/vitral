import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { nodeType } from "@/config/types";
import classes from "./BlueprintGroupNode.module.css";

type BlueprintGroupNodeProps = NodeProps<nodeType> & {
    /**
     * Dissolve this box, freeing its children. Absent in review mode, and absent on the canvas —
     * where group boxes are never drawn at all any more.
     */
    onDissolve?: (nodeId: string) => void;
};

function BlueprintGroupNodeImpl(props: BlueprintGroupNodeProps) {
    const rawData = props.data as Record<string, unknown>;
    const title = typeof rawData.title === "string" ? rawData.title : "Group";
    const level = rawData.blueprintGroupLevel === "paper"
        ? "paper"
        : rawData.blueprintGroupLevel === "intermediate"
            ? "intermediate"
            : "high";

    return (
        <div
            className={`${classes.root} ${
                level === "paper" ? classes.paper : level === "high" ? classes.high : classes.intermediate
            }`}
        >
            <div className={classes.label} title={title}>
                {title}
            </div>

            {props.onDissolve ? (
                /* `nodrag` so the pointer-down that presses it is not read as the start of a drag of
                   the box itself — every control drawn inside a React Flow node needs it. */
                <button
                    type="button"
                    className={`${classes.dissolve} nodrag`}
                    title={`Dissolve "${title}" — its contents stay, free to be arranged and wired`}
                    aria-label={`Dissolve ${title}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onDissolve?.(props.id);
                    }}
                >
                    x
                </button>
            ) : null}
        </div>
    );
}

export const BlueprintGroupNode = memo(BlueprintGroupNodeImpl);
