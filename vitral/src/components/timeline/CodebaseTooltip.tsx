import type { GitHubEvent } from "@/config/types";
import classes from "./Timeline.module.css";
import { GitHubEventPill } from "./GitHubEventPill";
import { formatDate } from "./timelineUtils";

type CodebaseTooltipProps = {
  event: GitHubEvent;
};

export function CodebaseTooltip({ event }: CodebaseTooltipProps) {
  return (
    <div className={classes.codeBaseTooltip}>
      <div className={classes.tooltipHeader}>
        <p style={{ fontWeight: "bold", fontSize: "var(--font-size-md)" }}>
          {event.title}
        </p>
        <GitHubEventPill type={event.type} />
      </div>
      <p style={{ fontSize: "var(--font-size-xs)", color: "var(--subtitle-color)" }}>
        {formatDate(event.occurredAt)}
      </p>
      <p style={{ fontSize: "var(--font-size-sm)", color: "var(--subtitle-color)" }}>
        Author: {event.actor && event.actor !== "" ? event.actor : "You"}
      </p>
      <p>
        <a
          style={{ backgroundColor: "rgba(237, 237, 237, 0.251)" }}
          href={event.url ?? "#"}
          target="_blank"
        >
          {event.key.slice(0, 8)}
        </a>
      </p>
    </div>
  );
}
