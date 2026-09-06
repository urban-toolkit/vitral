import {
    codeToUrl,
    describeLocatorStatus,
    LOCATOR_LENS_SUFFIX,
    LOCATOR_NEXT_STEP_LENSES,
    resolveLocatorReference,
    type LocatorIndex,
    type LocatorKind,
    type LocatorLens,
} from "@/pages/projectEditor/locators";

/**
 * The locator index as a LaTeX lookup table, so a paper can cite the canvas and be clicked.
 *
 * ## Why this exists at all
 *
 * A code in a paper is inert. `codeToUrl` has always been able to turn one into a link, but its only
 * caller is the markdown report — so an author writing in LaTeX had no way to get those URLs out
 * except by exporting a report and harvesting them by hand, and a hand-copied URL cannot survive a
 * renumbering. This emits every citable reference the project has, each with the node id that makes
 * it renumber-proof, in a file the paper `\input`s once.
 *
 * ## Why it is not in `report/`
 *
 * Everything in that folder is a function of a `ReportSnapshot` and emits markdown. This is a
 * projection of the **locator index** and needs nothing else about the project — the same thing
 * `codeToUrl` is, and that lives beside this file. Putting it in `report/` would drag `reportModel`,
 * `reportAbstract`, `reportEmphasis` and a `ReportSnapshot` fixture into a module that wants a
 * `LocatorIndex` and a handful of strings.
 *
 * Not inside `locators.ts` either: that file is on the canvas hot path and LaTeX escaping has no
 * business there.
 *
 * ## What it refuses to emit, and why that is the interesting part
 *
 * A definitions file whose entries do not work is worse than no file, because the failure surfaces
 * as a reader clicking a link in a published paper rather than as an error anyone can see. So this
 * emits a reference **only** when `resolveLocatorReference` accepts it — the same rule the markdown
 * applies to its next-step links, asked of the resolver rather than re-derived — and drops three
 * whole kinds that parse but navigate nowhere (see `CITABLE_KINDS`).
 *
 * Codes that no longer resolve are emitted **inert, with their reason**: nameable, visibly not a
 * link, never dressed as one. That is the house rule for an unresolvable reference, and here it buys
 * something specific — a citation to a deleted card becomes a compile-time warning naming the date
 * it was deleted, instead of a reader meeting a refusal notice on a canvas.
 *
 * Pure: no clock, no DOM, no store. `generatedAtIso` is stamped by the caller.
 */

/**
 * The kinds worth citing, which is narrower than the kinds that resolve.
 *
 * `file`, `stage` and `event` all carry `nodeId: null` in their viewpoints, so the reveal's camera
 * step never runs for them and nothing opens the timeline dock either. A `\vitralref{S1}` would
 * reset every filter, move nothing, and look broken. The useful spelling for a card's source
 * document is `R7F`, which this file does emit — it is a lens on a card, and the card has a node.
 *
 * `phase` was in this set carrying that same `null` — the rule was written down here and the kind it
 * indicted was left in the list, so every `\vitralref{P1}` ever published was a link that reset the
 * reader's filters and then sat still. A phase now centres its own summary glyph (`locators.ts`), so
 * it belongs here on the same terms as the rest. `locatorTex.test.ts` asserts the rule over every
 * entry this file emits rather than over the membership of this set, because the set is the thing
 * that was wrong.
 */
const CITABLE_KINDS: ReadonlySet<LocatorKind> = new Set<LocatorKind>([
    "phase",
    "activity",
    "requirement",
    "insight",
    "concept",
    "object",
    "person",
    "blueprintComponent",
]);

/**
 * Every spelling of an artifact worth defining, in the order they are emitted.
 *
 * `LOCATOR_NEXT_STEP_LENSES` is reused so the `.tex`, the report's next-step links and the reference
 * box's tooltip cannot come to list the lenses in different orders. `activityFile` is appended
 * because a definitions file is a lookup table rather than prose — the report hides `AF` on the
 * grounds that five letters is too much to scan in a line of running text, which is not a reason to
 * refuse an author who writes it.
 *
 * `D` is deliberately absent: `parseLocatorReference` canonicalises `R7D` to `R7`, so its URL would
 * be byte-identical and the entry pure duplication. The header says so, and `\vitralref{R7D}` warns.
 */
const TEX_LENSES: readonly LocatorLens[] = ["detail", ...LOCATOR_NEXT_STEP_LENSES, "activityFile"];

export type LocatorTexOptions = {
    projectId: string;
    projectTitle: string;
    /** Absolute. A paper cannot follow a path-only link — see `resolveCitationOrigin`. */
    origin: string;
    /** Exactly what `resolveRouterBasename()` returned, so links and the router agree. */
    basename: string;
    /** Stamped by the caller. This module never reads a clock. */
    generatedAtIso: string;
    /**
     * Whether a node holds an attachment a file lens could actually open.
     *
     * The index cannot answer this — `locators.ts` never reads node data — so the caller supplies the
     * same test the reveal applies before it moves the camera. Without it the file lenses would be
     * advertised for every card and refuse for most of them, which is the one failure this file is
     * built to prevent. Same seam as the report's `canvasUrlForCode`.
     */
    hasAttachment: (nodeId: string) => boolean;
};

export type LocatorTexFile = {
    tex: string;
    /** Fixed, so `\input{vitral-refs}` in the paper never has to change. */
    fileName: "vitral-refs.tex";
    stats: { artifacts: number; references: number; dead: number };
};

const LATEX_ESCAPES: Readonly<Record<string, string>> = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    $: "\\$",
    "#": "\\#",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
    // Not obviously specials, and they matter: in the default OT1 encoding a raw `<` sets as an
    // inverted exclamation mark and `>` as an inverted question mark.
    "<": "\\textless{}",
    ">": "\\textgreater{}",
    "|": "\\textbar{}",
};

/**
 * Text as a LaTeX literal.
 *
 * One pass over the string, so a backslash cannot be escaped into `\textbackslash{}` and then have
 * its own braces escaped again by a later rule — the classic way a two-pass escaper mangles output.
 *
 * Whitespace is collapsed rather than preserved. The entry block below sets `\endlinechar=-1`, so a
 * newline inside a title would join two words with no space at all rather than break a line.
 *
 * Non-ASCII passes through: the file is UTF-8 and the header says which LaTeX that needs.
 */
export function escapeLatex(text: string): string {
    return String(text ?? "")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/[\\&%$#_{}~^<>|]/gu, (character) => LATEX_ESCAPES[character] ?? character);
}

/** A `%`-commented block that no content can break out of. */
function comment(lines: readonly string[]): string[] {
    return lines.flatMap((line) => (
        line
            // A project title carrying a newline would otherwise end the comment and leave its tail
            // as executable TeX.
            .replace(/\r?\n/gu, " ")
            .split("\n")
            .map((part) => (part === "" ? "%" : `% ${part}`))
    ));
}

/** `2026-09-06 12:00Z` — the report's own minute format, without importing the report. */
function formatInstant(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`
        + ` ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}Z`;
}

export function buildLocatorTex(index: LocatorIndex, options: LocatorTexOptions): LocatorTexFile {
    const entryLines: string[] = [];
    const deadLines: string[] = [];
    const setAside: string[] = [];
    const retired: string[] = [];
    let artifacts = 0;

    for (const entry of index.entries) {
        if (!CITABLE_KINDS.has(entry.locator.kind)) continue;

        if (entry.status === "retired") {
            retired.push(`${entry.code} -> ${entry.supersededBy ?? "?"}`);
            continue;
        }
        if (entry.status !== "live") {
            deadLines.push(`\\vitral@dead{${entry.code}}{${escapeLatex(describeLocatorStatus(entry))}}`);
            continue;
        }

        // `inDocument` is not a filter. It means the markdown report anchors this target, which is
        // false for a card the study set aside — but the canvas still draws it and the resolver still
        // resolves it, so it is genuinely citable, and a paper arguing about a judgement call should
        // be able to cite the card that was set aside. Named in the header instead.
        if (!entry.inDocument) setAside.push(entry.code);

        let emitted = false;
        /*
         * Destinations already named for this artifact, so no two spellings claim the same place.
         *
         * The lens table is written for *cards*, where all six land somewhere different. Applied to
         * an activity several of them collapse — an activity's own root activity is itself, so `A1A`
         * is `A1` spelled longer — and a reference file offering both invites an author to think they
         * differ. The bare code is tried first, so it always wins the canonical name.
         */
        const destinations = new Set<string>();
        for (const lens of TEX_LENSES) {
            const reference = `${entry.code}${LOCATOR_LENS_SUFFIX[lens]}`;
            const resolution = resolveLocatorReference(index, reference);
            if (!resolution.ok) continue;
            const destination = JSON.stringify([resolution.viewpoint, resolution.openAttachmentOf]);
            if (destinations.has(destination)) continue;
            // One rule for both file lenses, and stricter than the report's, which only tests `F`.
            if (resolution.openAttachmentOf !== null
                && !options.hasAttachment(resolution.openAttachmentOf)) continue;

            const url = codeToUrl(index, reference, {
                projectId: options.projectId,
                basename: options.basename,
                origin: options.origin,
                // No `at`. It is read and deliberately not honoured, and it is the only thing that
                // would put a `%` into one of these URLs.
            });
            if (url === null) continue;

            // Title and node are the cited *artifact's*, on every spelling — `R7P` carries R7's
            // title and R7's node, matching the `n` in its own URL.
            destinations.add(destination);
            entryLines.push(
                `\\vitral@entry{${reference}}{${url}}{${entry.targetId}}{${escapeLatex(entry.title)}}`,
            );
            emitted = true;
        }
        if (emitted) artifacts += 1;
    }

    const header = comment([
        "vitral-refs.tex — generated by Vitral. Do not edit; regenerate from the project.",
        "",
        `Project   : ${options.projectTitle} (${options.projectId})`,
        `Canvas    : ${options.origin}${options.basename === "/" ? "" : options.basename}`,
        `Snapshot  : ${formatInstant(index.asOf.capturedAt)}`,
        `Generated : ${formatInstant(options.generatedAtIso)}`,
        `Contains  : ${entryLines.length} references over ${artifacts} artifacts`
        + `${deadLines.length > 0 ? `; ${deadLines.length} codes that no longer resolve` : ""}`,
        "",
        "Check the Canvas line. It is where every link below points, and it is taken from",
        "wherever this file was exported — a file exported from a development server links",
        "to a development server.",
        "",
        "Usage — this file defines its own commands, so there is no package to install.",
        "  \\usepackage{hyperref}",
        "  \\input{vitral-refs}",
        "  ... the reviewers could not check the claim (\\vitralref{R7}) ...",
        "",
        "Commands",
        "  \\vitralref{R7}        a link labelled R7, opening the canvas at R7",
        "  \\vitralrefurl{R7}     the bare URL",
        "  \\vitralreftitle{R7}   the cited artifact's title",
        "  \\vitralrefnode{R7}    the node id the link was written against",
        "  \\vitralrefbase        the canvas this file points at",
        "  \\vitralrefproject     the project id",
        "  \\vitralrefasof        the snapshot these references were numbered over",
        "  \\vitralrefphasenote   what a phase code promises, for a footnote",
        "  \\vitralrefstyle{..}   how a code is set. Redefine it; the default is \\texttt.",
        "",
        "Suffixes. One artifact, six views: R7 is the card, R7P its phase, R7A the root",
        "activity of its thread, R7T the thread, R7F its file, R7AF that activity's file.",
        "D is the explicit spelling of the bare code — write \\vitralref{R7}.",
        "",
        "A suffix is defined only where the canvas accepts it, so \\vitralref{R7T} on a card",
        "belonging to no thread warns at compile time instead of printing a dead link. So",
        "does a code that no longer resolves; those print inert, with the reason.",
        "",
        "A suffix is also left undefined where it would name a place another spelling already",
        "names: P1P is the phase P1 belongs to, which is P1, and A1A is A1's own root activity.",
        "Those warn too, and the shorter spelling is the one to write.",
        ...(setAside.length > 0
            ? ["", `Set aside — still citable, but marked not relevant: ${setAside.join(", ")}`]
            : []),
        ...(retired.length > 0
            ? ["", `Renumbered since — update these citations: ${retired.join(", ")}`]
            : []),
        "",
        "Not emitted: file codes (F1), timeline stages (S1) and milestones (E1). They parse,",
        "but they name nothing the canvas can centre on, so a link to one appears to do",
        "nothing. Cite R7F for a card's source document.",
        "",
        "Phase codes name the phase containing an anchor activity. Phase boundaries are",
        "recomputed from the project's own timing and content, so a phase's extent, label",
        "and position may differ from when this was written; the anchor activity will not.",
        "",
        "UTF-8. Needs a LaTeX from 2018 or later, or \\usepackage[utf8]{inputenc}.",
    ]);

    /*
     * The entry block, under changed catcodes, and every line of this is load-bearing.
     *
     * `\&` written into a macro body does **not** work: hyperref fixes catcodes as it reads a literal
     * argument, but a URL arriving through `\csname` expansion was tokenised long before. Percent
     * encoding is worse, because `%` is the comment character. Tokenising the block itself is what
     * BibTeX styles do and it is the only approach that survives macro storage.
     *
     * `\` and `{`/`}` keep their catcodes: `\` must stay the escape character or `\vitral@entry`
     * stops being a control sequence, and the braces must stay delimiters or the arguments stop
     * parsing. A generated URL contains none of the three — `URLSearchParams` would have escaped
     * them — which the test asserts rather than assumes.
     *
     * Escaped titles still work under these catcodes, because a control sequence is formed from the
     * escape character and the next character token whatever *its* catcode is: `\&` is still `\&`.
     *
     * `\endlinechar=-1` comes first. Without it every line ending emits a space, and `\input`ting
     * this file in the document body would inject one spurious space per entry into the typeset
     * text. It also means `%` cannot start a comment inside the block, which is why the header sits
     * entirely above it.
     */
    const block = [
        "\\begingroup",
        // `@` has to be a letter where `\vitral@entry` is *called*, not only where it was
        // defined: after the `\makeatother` above, `\vitral@entry` reads as `\vitral` followed
        // by `@entry` and the file dies on an undefined control sequence. Inside the group, so
        // `\endgroup` puts the catcode back along with everything else.
        "\\makeatletter",
        // Every number is closed with `\relax`. TeX ends a numeric constant on the first token
        // that cannot continue it, which is normally the space an end-of-line produces — and the
        // first thing this block does is switch that space off. Relying on the *next* line's
        // leading control sequence to terminate the previous line's number works, but only for
        // as long as every line here happens to start with one. `\relax` makes it not a
        // question, which matters for a file no test in this repo can compile.
        "\\endlinechar=-1\\relax",
        "\\catcode`\\&=12\\relax",
        "\\catcode`\\#=12\\relax",
        "\\catcode`\\$=12\\relax",
        "\\catcode`\\^=12\\relax",
        "\\catcode`\\_=12\\relax",
        "\\catcode`\\~=12\\relax",
        "\\catcode`\\%=12\\relax",
        ...entryLines,
        ...deadLines,
        "\\endgroup",
    ];

    const preamble = [
        "\\makeatletter",
        "\\providecommand{\\vitralrefstyle}[1]{\\texttt{#1}}",
        `\\providecommand{\\vitralrefbase}{${options.origin}${options.basename === "/" ? "" : options.basename}}`,
        `\\providecommand{\\vitralrefproject}{${options.projectId}}`,
        `\\providecommand{\\vitralrefasof}{${formatInstant(index.asOf.capturedAt)}}`,
        "\\providecommand{\\vitralrefphasenote}{A phase code names the phase containing its anchor"
        + " activity. Phase boundaries are recomputed from the project's own timing and content, so a"
        + " phase's extent, label and position may differ from when this was written; the anchor"
        + " activity will not.}",
        "\\gdef\\vitral@entry#1#2#3#4{%",
        "  \\expandafter\\gdef\\csname vitral@url@#1\\endcsname{#2}%",
        "  \\expandafter\\gdef\\csname vitral@node@#1\\endcsname{#3}%",
        "  \\expandafter\\gdef\\csname vitral@title@#1\\endcsname{#4}%",
        "}",
        "\\gdef\\vitral@dead#1#2{\\expandafter\\gdef\\csname vitral@dead@#1\\endcsname{#2}}",
        // Nameable, visibly inert, never dressed as a link — the house rule for a reference that
        // cannot be opened, and the reason a stale citation is a compile-time warning rather than a
        // reader meeting a refusal notice.
        "\\gdef\\vitral@missing#1{%",
        "  \\ifcsname vitral@dead@#1\\endcsname",
        "    \\GenericWarning{}{Vitral: \\csname vitral@dead@#1\\endcsname}%",
        "  \\else",
        "    \\GenericWarning{}{Vitral: no reference #1 in vitral-refs.tex}%",
        "  \\fi",
        "  \\vitralrefstyle{#1}%",
        "}",
        "\\gdef\\vitral@field#1#2{%",
        "  \\ifcsname vitral@#1@#2\\endcsname",
        "    \\csname vitral@#1@#2\\endcsname",
        "  \\else",
        "    \\vitral@missing{#2}%",
        "  \\fi",
        "}",
        // Robust, not fragile: these will end up in section titles, captions and footnotes, which are
        // moving arguments, and `\href` breaks there.
        "\\DeclareRobustCommand{\\vitralrefurl}[1]{\\vitral@field{url}{#1}}",
        "\\DeclareRobustCommand{\\vitralrefnode}[1]{\\vitral@field{node}{#1}}",
        "\\DeclareRobustCommand{\\vitralreftitle}[1]{\\vitral@field{title}{#1}}",
        "\\DeclareRobustCommand{\\vitralref}[1]{%",
        "  \\ifcsname vitral@url@#1\\endcsname",
        "    \\href{\\csname vitral@url@#1\\endcsname}{\\vitralrefstyle{#1}}%",
        "  \\else",
        "    \\vitral@missing{#1}%",
        "  \\fi",
        "}",
        "\\makeatother",
    ];

    return {
        tex: [...header, "", ...preamble, "", ...block, ""].join("\n"),
        fileName: "vitral-refs.tex",
        stats: { artifacts, references: entryLines.length, dead: deadLines.length },
    };
}
