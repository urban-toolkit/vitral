import type { BlueprintEvent } from "@/config/types";
import classes from "./Timeline.module.css";
import { formatDate } from "./timelineUtils";

type BlueprintTooltipProps = {
  event: BlueprintEvent;
};

export function BlueprintTooltip({ event }: BlueprintTooltipProps) {
  return (
    <div className={classes.codeBaseTooltip}>
      <div className={classes.tooltipHeader}>
        <p style={{ fontWeight: "bold", fontSize: "var(--font-size-md)" }}>
          {event.name}
        </p>
      </div>

      <p style={{ fontSize: "var(--font-size-xs)", color: "var(--subtitle-color)" }}>
        {formatDate(event.occurredAt)}
      </p>

      {event.paperTitle ? (
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--subtitle-color)" }}>
          {event.paperTitle}
        </p>
      ) : null}

      <p style={{ fontSize: "var(--font-size-sm)", whiteSpace: "pre-wrap" }}>
        {event.paperDescription && event.paperDescription.trim() !== ""
          ? event.paperDescription
          : "No paper description available."}
      </p>
    </div>
  );
}

