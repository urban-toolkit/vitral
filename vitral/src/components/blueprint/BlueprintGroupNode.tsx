import { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { nodeType } from "@/config/types";
import classes from "./BlueprintGroupNode.module.css";

function BlueprintGroupNodeImpl(props: NodeProps<nodeType>) {
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
        </div>
    );
}

export const BlueprintGroupNode = memo(BlueprintGroupNodeImpl);
