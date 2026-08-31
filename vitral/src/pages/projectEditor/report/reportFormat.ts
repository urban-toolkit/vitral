/**
 * Every date, every escape and every anchor in the report goes through here.
 *
 * The reason is one property: **the same project must produce the same bytes**. A report that changes
 * because it was exported in a different timezone, or in a different browser locale, cannot be
 * diffed between two versions of a study and cannot be checked by a reader against the canvas. So
 * `toLocaleDateString` is banned in the report path — `ClusterGlyph` uses it, correctly, because a
 * glyph is read on screen by one person in one place; a document is not.
 *
 * Pure, and free of any clock: the only instants it ever formats are ones handed to it.
 */

/** `2026-04-02`, in UTC, or an em dash. UTC getters only — local ones move the date at midnight. */
export function formatIsoDay(iso: string | null | undefined): string {
    if (typeof iso !== "string" || iso.trim() === "") return "—";
    const parsed = new Date(iso);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) return "—";
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** `2026-04-02 14:35Z`. The `Z` is not decoration — it says which clock this is. */
export function formatIsoMinute(iso: string | null | undefined): string {
    if (typeof iso !== "string" || iso.trim() === "") return "—";
    const parsed = new Date(iso);
    if (!Number.isFinite(parsed.getTime())) return "—";
    const hours = String(parsed.getUTCHours()).padStart(2, "0");
    const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
    return `${formatIsoDay(iso)} ${hours}:${minutes}Z`;
}

export function formatDayRange(from: string | null, to: string | null): string {
    const start = formatIsoDay(from);
    const end = formatIsoDay(to);
    if (start === "—" && end === "—") return "—";
    if (start === end) return start;
    return `${start} – ${end}`;
}

/** Whole days between two instants, or null when either is unreadable. */
export function daysBetween(from: string | null, to: string | null): number | null {
    if (!from || !to) return null;
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Text that has to survive inside a markdown table cell.
 *
 * Pipes would end the cell and newlines would end the row, so both are neutralised — and
 * **nothing is truncated**. A report that silently shortens what the researcher wrote is the bug this
 * whole rework exists to fix, so where a value is too long for a cell the caller renders it elsewhere
 * (its own appendix entry always holds the untouched text) rather than cutting it here.
 */
export function tableCell(text: string): string {
    return String(text ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, "<br>")
        .trim();
}

/** Verbatim text as a blockquote, so a quoted passage cannot be mistaken for the report's own voice. */
export function quoteBlock(text: string): string {
    const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
    return lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`)).join("\n");
}

/**
 * GitHub's heading-slug algorithm, with the de-duplication counter the caller owns.
 *
 * Reimplemented rather than assumed, and called by the *same pass* that emits the heading, so a
 * heading and the link that points at it are generated from one string and cannot disagree. That
 * matters because `react-markdown` renders no raw HTML without `rehype-raw`, so an explicit
 * `<a id>` is not available and the slug is the only anchor there is.
 *
 * `taken` is threaded through rather than held here so the function stays pure and one document's
 * numbering cannot leak into the next.
 */
export function headingSlug(text: string, taken: Map<string, number>): string {
    const base = String(text ?? "")
        .trim()
        .toLowerCase()
        // Keep letters, numbers, spaces and hyphens; drop the rest, as GitHub does.
        .replace(/[^\p{L}\p{N} \-_]/gu, "")
        .replace(/ /g, "-");
    const slug = base === "" ? "section" : base;
    const seen = taken.get(slug);
    if (seen === undefined) {
        taken.set(slug, 0);
        return slug;
    }
    const next = seen + 1;
    taken.set(slug, next);
    return `${slug}-${next}`;
}

/**
 * The download name.
 *
 * Carries the export day, because the alternative is a folder of files called `my-study.md` that
 * cannot be told apart — and a report is a snapshot of a moving project, so which snapshot it is
 * belongs in the name.
 */
export function reportFileName(projectTitle: string, generatedAtIso: string): string {
    const slug = String(projectTitle ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const day = formatIsoDay(generatedAtIso);
    return `${slug === "" ? "project-report" : slug}-${day === "—" ? "report" : day}.md`;
}

/** `3 cards` / `1 card`, so no sentence in the document reads "1 cards". */
export function plural(count: number, singular: string, pluralForm?: string): string {
    return `${count} ${count === 1 ? singular : pluralForm ?? `${singular}s`}`;
}

/** A markdown table from a header row and body rows, already escaped by the caller. */
export function table(headers: string[], rows: string[][]): string[] {
    if (rows.length === 0) return [];
    return [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
    ];
}
