/**
 * The LaTeX reference file, as syntax. Run with `npm run test:locator-tex`.
 *
 * `locators.test.ts` pins the *grammar's* properties — what a code promises as a project changes.
 * This pins what the emitted file promises as a **document**: that nothing is advertised the canvas
 * would refuse, that every character in it survives the catcode block it is tokenised under, and
 * that a title cannot break out of the syntax that carries it.
 *
 * The distinction matters because the two fail differently. A grammar bug renumbers a citation; a
 * syntax bug here does not fail at all until an author compiles a paper, or worse, until a reader
 * clicks a link in a published one.
 *
 * Kept inside `src` so `tsc` typechecks it; no Node-only globals, so it runs under esbuild + node.
 */

import type { edgeType, nodeType } from "@/config/types";
import {
    buildLocatorIndex,
    codeToUrl,
    resolveLocatorReference,
    type LocatorIndex,
} from "@/pages/projectEditor/locators";
import { buildLocatorTex, escapeLatex } from "@/pages/projectEditor/locatorTex";
import { buildActivityClusters } from "@/pages/projectEditor/canvasClusters";
import { buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean) {
    checks += 1;
    if (condition) return;
    failures += 1;
    console.log(`FAIL  ${label}`);
}

function equal(label: string, actual: unknown, expected: unknown) {
    check(
        `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
        JSON.stringify(actual) === JSON.stringify(expected),
    );
}

// --- Fixtures -----------------------------------------------------------------------------------

function day(index: number): string {
    return new Date(Date.UTC(2026, 0, 1 + index, 12, 0, 0)).toISOString();
}

function card(
    id: string,
    label: string,
    title: string,
    createdAt: string,
    extra: Record<string, unknown> = {},
): nodeType {
    return {
        id,
        position: { x: 0, y: 0 },
        type: "card",
        data: {
            label,
            type: "social",
            title,
            createdAt,
            __history: [
                { at: createdAt, kind: "data", data: { label, title } },
                { at: createdAt, kind: "position", position: { x: 0, y: 0 } },
            ],
            ...extra,
        },
    } as unknown as nodeType;
}

function edge(id: string, source: string, target: string, label: string): edgeType {
    return {
        id,
        source,
        target,
        type: "relation",
        label,
        data: { label, createdAt: day(0) },
    } as unknown as edgeType;
}

type Fixture = { nodes: nodeType[]; edges: edgeType[] };

/** Two threads, a card on each, one attachment, and one tombstone. */
function studyFixture(): Fixture {
    return {
        nodes: [
            card("a1", "activity", "Kickoff", day(0)),
            // Every LaTeX special this file knows about, in one title.
            card("r1", "requirement", "Cost < 50% & rising: {a_b} ~ $x^2$ \\ | > done", day(1), {
                attachmentIds: ["file-1"],
            }),
            card("a2", "activity", "Interviews", day(2)),
            card("i1", "insight", "Nobody trusted unmarked text", day(3)),
            card("c1", "concept", "Provenance surface", day(4)),
            card("o1", "object", "Set aside on purpose", day(5), { relevant: false }),
            card("r2", "requirement", "Deleted since", day(6), { deletedAt: day(9) }),
        ],
        edges: [
            edge("e1", "a1", "r1", "derived from"),
            edge("e2", "a2", "i1", "derived from"),
            edge("e3", "a2", "c1", "relevant to"),
            edge("e4", "a1", "o1", "derived from"),
        ],
    };
}

function indexOf(fixture: Fixture): LocatorIndex {
    const live = fixture.nodes.filter((node) => {
        const deletedAt = (node.data as Record<string, unknown>).deletedAt;
        return typeof deletedAt !== "string" || deletedAt.trim() === "";
    });
    const membership = buildActivityTreeMembership(live, fixture.edges);
    const salience = buildSalienceIndex(live, fixture.edges, membership);
    const activities = live.filter((node) => (node.data as Record<string, unknown>).label === "activity");
    const clusters = buildActivityClusters({
        activities,
        edges: fixture.edges,
        membership,
        score: salience.score,
    });
    return buildLocatorIndex({
        nodes: fixture.nodes,
        edges: fixture.edges,
        files: [{ sha256: "file-1", name: "transcript.md", createdAt: day(1) }],
        timeline: { stages: [], designStudyEvents: [] },
        membership,
        clusters,
        asOf: { version: 7, capturedAt: day(50) },
    });
}

const OPTIONS = {
    projectId: "9f0e4c11-2222-3333-4444-555566667777",
    projectTitle: "Vitral design study",
    origin: "https://arcade.evl.uic.edu",
    basename: "/vitral",
    generatedAtIso: day(51),
    // Annotated, or TypeScript infers `nodeId is "r1"` from the comparison and every override that
    // names a different node stops being assignable.
    hasAttachment: ((nodeId: string) => nodeId === "r1") as (nodeId: string) => boolean,
};

function texFor(fixture: Fixture = studyFixture(), overrides: Partial<typeof OPTIONS> = {}) {
    const index = indexOf(fixture);
    return { index, file: buildLocatorTex(index, { ...OPTIONS, ...overrides }) };
}

/** Every `\vitral@entry{CODE}{URL}{NODE}{TITLE}` in the file, parsed back out. */
function entriesOf(tex: string): Array<{ reference: string; url: string; node: string; title: string }> {
    const out: Array<{ reference: string; url: string; node: string; title: string }> = [];
    for (const line of tex.split("\n")) {
        const match = /^\\vitral@entry\{([^}]*)\}\{([^}]*)\}\{([^}]*)\}\{(.*)\}$/.exec(line);
        if (!match) continue;
        out.push({ reference: match[1], url: match[2], node: match[3], title: match[4] });
    }
    return out;
}

// --- 1. Nothing is advertised that the canvas would refuse --------------------------------------
//
// The whole point of asking the resolver rather than re-deriving membership: a definitions file whose
// entries do not resolve fails as a reader clicking a link in a published paper.
{
    const { index, file } = texFor();
    const entries = entriesOf(file.tex);
    check("the file has entries at all", entries.length > 0);

    let allResolve = true;
    for (const entry of entries) {
        if (!resolveLocatorReference(index, entry.reference).ok) {
            allResolve = false;
            console.log(`      ${entry.reference} does not resolve`);
        }
    }
    check("every emitted reference resolves", allResolve);
    equal("and the count is reported", file.stats.references, entries.length);
}

// --- 2. Every URL survives the catcode block ----------------------------------------------------
//
// The block sets `&` and friends to catcode 12 but deliberately leaves `\`, `{` and `}` alone: `\`
// must stay the escape character or `\vitral@entry` stops being a control sequence, and the braces
// must stay delimiters or the arguments stop parsing. So a URL containing one of those three would
// break the file. Asserted rather than assumed, because a future URL shape could introduce one.
{
    const { file } = texFor();
    const entries = entriesOf(file.tex);

    let safe = true;
    let hasPercent = false;
    let hasAt = false;
    for (const entry of entries) {
        if (!/^[A-Za-z0-9:/?=&._~-]+$/u.test(entry.url)) {
            safe = false;
            console.log(`      unsafe URL: ${entry.url}`);
        }
        if (entry.url.includes("%")) hasPercent = true;
        if (/[?&]at=/u.test(entry.url)) hasAt = true;
    }
    check("no URL contains a character the block does not neutralise", safe);
    check("no URL is percent-encoded", !hasPercent);
    // `at` is read and deliberately not honoured, and it is the only thing that would percent-encode.
    check("no URL carries an `at` pin", !hasAt);
}

// --- 3. URLs are `codeToUrl`'s, not a second spelling of it -------------------------------------
{
    const { index, file } = texFor();
    let allMatch = true;
    for (const entry of entriesOf(file.tex)) {
        const expected = codeToUrl(index, entry.reference, {
            projectId: OPTIONS.projectId,
            basename: OPTIONS.basename,
            origin: OPTIONS.origin,
        });
        if (expected !== entry.url) {
            allMatch = false;
            console.log(`      ${entry.reference}: ${entry.url} != ${expected}`);
        }
    }
    check("every URL is exactly what codeToUrl produces", allMatch);
}

// --- 4. Escaping is one pass --------------------------------------------------------------------
{
    equal("a backslash becomes textbackslash",
        escapeLatex("a\\b"), "a\\textbackslash{}b");
    // The classic two-pass bug: the braces `\textbackslash{}` introduces must not be re-escaped.
    check("and its braces are not escaped again",
        !escapeLatex("a\\b").includes("\\{\\}"));
    equal("the ordinary specials",
        escapeLatex("& % $ # _ { }"), "\\& \\% \\$ \\# \\_ \\{ \\}");
    equal("tilde and caret take text forms",
        escapeLatex("~^"), "\\textasciitilde{}\\textasciicircum{}");
    equal("and the OT1 traps",
        escapeLatex("<>|"), "\\textless{}\\textgreater{}\\textbar{}");
    equal("whitespace collapses", escapeLatex("a \n\t b "), "a b");
    equal("non-ASCII passes through", escapeLatex("café — “x”"), "café — “x”");
}

// --- 5. No entry line can break the file --------------------------------------------------------
//
// `\endlinechar=-1` means a newline inside an argument would not break a line, it would join two
// words with no space; and a raw newline would end the `\vitral@entry` call mid-argument.
{
    const { file } = texFor();
    const entries = entriesOf(file.tex);
    const titled = entries.find((entry) => entry.reference === "R1");
    check("the title-heavy card is emitted", titled !== undefined);
    if (titled) {
        equal("with every special escaped",
            titled.title,
            "Cost \\textless{} 50\\% \\& rising: \\{a\\_b\\} \\textasciitilde{}"
            + " \\$x\\textasciicircum{}2\\$ \\textbackslash{} \\textbar{} \\textgreater{} done");
    }
    check("no entry line contains a raw newline",
        entries.every((entry) => !entry.title.includes("\n") && !entry.url.includes("\n")));
}

// --- 6. The header cannot be broken out of ------------------------------------------------------
//
// A project title is author-supplied text landing inside a `%` comment block. A newline in it would
// end the comment and leave the tail as executable TeX.
{
    const { file } = texFor(studyFixture(), {
        projectTitle: "Sneaky\n\\immediate\\write18{rm -rf /}",
    });
    const header = file.tex.split("\n").slice(0, file.tex.split("\n").indexOf("\\makeatletter"));
    check("every header line is a comment",
        header.every((line) => line === "" || line.startsWith("%")));
    check("and the injected control sequence never reaches column zero",
        !file.tex.includes("\n\\immediate"));
}

// --- 7. Dead and live are disjoint --------------------------------------------------------------
{
    const { file } = texFor();
    check("the deleted card is named", file.tex.includes("\\vitral@dead{R2}"));
    check("with the reason a reader needs", /\\vitral@dead\{R2\}\{[^}]*deleted/u.test(file.tex));
    check("and gets no url", !file.tex.includes("vitral@url@R2\\endcsname"));
    check("no dead code is also an entry",
        !entriesOf(file.tex).some((entry) => entry.reference.startsWith("R2")));
    equal("the dead count is reported", file.stats.dead, 1);
}

// --- 8. The kinds that navigate nowhere are omitted ---------------------------------------------
//
// `file`, `stage` and `event` carry `nodeId: null`, so the reveal's camera step never runs: a link
// to one resets every filter and moves nothing. `R7F` is the useful spelling and it is a lens.
{
    const { file } = texFor();
    const references = entriesOf(file.tex).map((entry) => entry.reference);
    check("no bare file code", !references.includes("F1"));
    check("but the file lens on its owner is there", references.includes("R1F"));
    // `hasAttachment` is true only for r1, so a card without one must not advertise `F`.
    check("and a card with no attachment does not offer one",
        !references.includes("I1F") && !references.includes("C1F"));
}

// --- 9. A set-aside card is citable, and said so ------------------------------------------------
{
    const { file } = texFor();
    check("the set-aside card still gets a reference",
        entriesOf(file.tex).some((entry) => entry.reference === "O1"));
    check("and the header names it", /Set aside[^\n]*O1/u.test(file.tex));
}

// --- 10. Structure is balanced ------------------------------------------------------------------
{
    const { file } = texFor();
    const lines = file.tex.split("\n");
    equal("two makeatletter: one for the definitions, one for the calls",
        lines.filter((line) => line === "\\makeatletter").length, 2);
    equal("one makeatother", lines.filter((line) => line === "\\makeatother").length, 1);
    equal("one begingroup", lines.filter((line) => line === "\\begingroup").length, 1);
    equal("one endgroup", lines.filter((line) => line === "\\endgroup").length, 1);

    const open = lines.indexOf("\\begingroup");
    const close = lines.indexOf("\\endgroup");
    // The bug this catches: entries are emitted after the preamble's `\makeatother`, so without a
    // second `\makeatletter` inside the group every `\vitral@entry` reads as `\vitral` plus
    // `@entry` and the file dies on an undefined control sequence. Nothing else here would notice.
    check("at-sign is a letter where the entries are called", lines[open + 1] === "\\makeatletter");
    check("endlinechar is neutralised next", lines[open + 2] === "\\endlinechar=-1\\relax");
    // Once the end-of-line space is gone, nothing else terminates a numeric constant unless it is
    // said explicitly. Cheap insurance for a file nothing in this repo can compile.
    check("every catcode assignment is explicitly terminated",
        lines.slice(open, close).filter((line) => line.startsWith("\\catcode"))
            .every((line) => line.endsWith("\\relax")));
    check("every entry sits inside the group",
        lines.every((line, at) => (
            !(line.startsWith("\\vitral@entry") || line.startsWith("\\vitral@dead{"))
            || (at > open && at < close)
        )));
    check("the file ends with a newline", file.tex.endsWith("\n"));
    equal("the filename is fixed", file.fileName, "vitral-refs.tex");
}

// --- 11. Lens order is the shared one, and D is never emitted -----------------------------------
{
    const { file } = texFor();
    const forR1 = entriesOf(file.tex)
        .filter((entry) => /^R1(?![0-9])/u.test(entry.reference))
        .map((entry) => entry.reference);
    // `LOCATOR_NEXT_STEP_LENSES` order, bare code first, `AF` appended. `R1AF` is absent here on
    // purpose: it opens the *root activity's* file, and `hasAttachment` is true only for R1 itself.
    equal("one artifact's spellings in the shared order",
        forR1, ["R1", "R1P", "R1A", "R1T", "R1F"]);

    // Which is the distinction check 8 makes from the other side: give the activity an attachment
    // and `AF` appears, while `F` still follows R1's own.
    const withActivityFile = texFor(studyFixture(), {
        hasAttachment: (nodeId: string) => nodeId === "a1",
    });
    const spellings = entriesOf(withActivityFile.file.tex)
        .filter((entry) => /^R1(?![0-9])/u.test(entry.reference))
        .map((entry) => entry.reference);
    check("AF follows the root activity's attachment", spellings.includes("R1AF"));
    check("and F follows the card's own", !spellings.includes("R1F"));
    // `parseLocatorReference` canonicalises R1D to R1, so an entry would be pure duplication.
    check("D is never emitted", !forR1.includes("R1D"));

    const titles = new Set(entriesOf(file.tex)
        .filter((entry) => /^R1(?![0-9])/u.test(entry.reference))
        .map((entry) => entry.title));
    equal("every spelling carries the artifact's own title, not the landing target's", titles.size, 1);
}

// --- 12. Determinism, to one line ---------------------------------------------------------------
//
// Two exports of an unchanged project should diff to nothing but the generation instant, so an
// author can see at a glance whether regenerating changed any citation.
{
    const fixture = studyFixture();
    const first = buildLocatorTex(indexOf(fixture), OPTIONS);
    const second = buildLocatorTex(indexOf(fixture), OPTIONS);
    equal("the same project produces the same bytes", first.tex, second.tex);

    const later = buildLocatorTex(indexOf(fixture), { ...OPTIONS, generatedAtIso: day(60) });
    const differing = first.tex.split("\n")
        .filter((line, at) => line !== later.tex.split("\n")[at]);
    equal("and a later export differs on one line only", differing.length, 1);
    check("which is the generated stamp", differing[0].startsWith("% Generated"));
}

// --- 13. A phase reference is emitted, and points at the phase ----------------------------------
//
// The regression guard for the borrowed-node bug: a phase's `targetId` belongs to its anchor
// activity, so before the resolver learned to skip the claim for phases, every `P` link in a
// generated file opened the thread at Detail under a notice naming a rename that never happened.
{
    const { index, file } = texFor();
    const phase = entriesOf(file.tex).find((entry) => entry.reference === "P1");
    check("a phase reference is emitted", phase !== undefined);
    if (phase) {
        const resolution = resolveLocatorReference(index, "P1", phase.node);
        check("and following it with its own node resolves", resolution.ok);
        if (resolution.ok) {
            equal("to the phase", resolution.target.code, "P1");
            equal("with no renumbering claimed", resolution.renumberedFrom, null);
        }
    }
}

// --- 13b. Every entry gives the camera somewhere to go -----------------------------------------
//
// `CITABLE_KINDS` exists to keep out kinds whose viewpoint carries `nodeId: null`, because the
// reveal's camera step is `if (viewpoint.nodeId) requestNodeFocus(...)` — so such a link resets the
// reader's filters, moves nothing, and looks broken. That rule was enforced by hand, as membership
// of a set, and `phase` sat in the set carrying exactly the `null` the comment beside it indicted:
// every `\vitralref{P1}` ever published was a dead link that looked alive.
//
// Asserted over the emitted entries instead of over the set, because the set is what was wrong. The
// node also has to be one the canvas actually draws — a synthetic glyph id is legitimate here (a
// phase has no stored node) as long as something answers to it.
{
    const { index, file } = texFor();
    const entries = entriesOf(file.tex);

    let allNavigate = true;
    const stranded: string[] = [];
    for (const entry of entries) {
        const resolution = resolveLocatorReference(index, entry.reference);
        if (!resolution.ok || resolution.viewpoint.nodeId === null) {
            allNavigate = false;
            stranded.push(entry.reference);
        }
    }
    check(`every emitted reference moves the camera${stranded.length > 0 ? ` (stranded: ${stranded.join(", ")})` : ""}`,
        allNavigate);

    // The phase specifically, since it is the one this guard was written for.
    const phase = entries.find((entry) => entry.reference === "P1");
    check("the bare phase reference is emitted", phase !== undefined);
    if (phase) {
        const resolution = resolveLocatorReference(index, "P1");
        check("and lands on the phase's own summary glyph",
            resolution.ok && String(resolution.viewpoint.nodeId ?? "").startsWith("vz:c:"));
        check("without opening the phase into its threads",
            resolution.ok && resolution.viewpoint.focus.clusterId === null);
    }

    // `P1P` is "the phase P1 belongs to", which is P1. The destination dedup has to collapse it, or
    // the file would offer an author two spellings for one place and imply they differ.
    check("the phase's own overview lens is not offered as a second destination",
        entries.every((entry) => entry.reference !== "P1P"));

    // A glyph holds no attachment, so neither file lens may be advertised for a phase.
    check("and no file lens is advertised for a phase",
        entries.every((entry) => entry.reference !== "P1F"));
}

// --- 14. The canvas line names the deployment, not the exporter's host --------------------------
{
    const { file } = texFor();
    check("the header states where links point",
        file.tex.includes("% Canvas    : https://arcade.evl.uic.edu/vitral"));
    check("and the macro agrees",
        file.tex.includes("\\providecommand{\\vitralrefbase}{https://arcade.evl.uic.edu/vitral}"));

    // A dev export must be obvious on sight rather than at review time.
    const dev = texFor(studyFixture(), { origin: "http://localhost:5173", basename: "/" });
    check("a root basename adds no path",
        dev.file.tex.includes("% Canvas    : http://localhost:5173\n"));
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} locator-tex check(s) failed`);
}
console.log("ALL PASS");
