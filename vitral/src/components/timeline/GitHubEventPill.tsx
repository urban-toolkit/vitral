import type { GitHubEventType } from "@/config/types";
import classes from "./Timeline.module.css";
import { GIT_LABELS } from "./timelineUtils";

type GitHubEventPillProps = {
  type: GitHubEventType;
};

export function GitHubEventPill({ type }: GitHubEventPillProps) {
  return (
    <span
      className={`${classes.ghPill} ${classes[`ghPill_${type}`]}`}
      title={GIT_LABELS[type]}
    >
      {GIT_LABELS[type]}
    </span>
  );
}
