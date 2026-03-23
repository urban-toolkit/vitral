import type { GitHubEventType } from "@/config/types";

export const GIT_LABELS: Record<GitHubEventType, string> = {
  commit: "Commit",
  issue_opened: "Issue opened",
  issue_closed: "Issue closed",
  pr_opened: "PR opened",
  pr_closed: "PR closed",
  pr_merged: "PR merged",
};

export function formatDate(iso: string) {
  const parsedDate = new Date(iso);
  if (Number.isNaN(parsedDate.getTime())) return iso;

  return parsedDate.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const toDate = (date: Date | string) => (date instanceof Date ? date : new Date(date));

export const fromDate = (date: Date | string) =>
  date instanceof Date ? date.toISOString() : date;

export const setRefPos = (el: HTMLSpanElement | null, x: number, y: number) => {
  if (!el) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
};
