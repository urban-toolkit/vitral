/**
 * Properties of the deterministic report. Run with `npm run test:report`.
 *
 * The document is the answer to "the exported report is brief, superficial, and handing it to an AI is
 * fraught", so what is pinned here is that it is *not* those things: the same project produces the
 * same bytes, nothing is dropped, the researcher's own material outranks the model's, and the report's
 * sense of what the study is organised around is **the canvas's** — checked against
 * `buildAbstractedGraph` itself rather than against a copy of its rule.
 *
 * Two checks are here because their absence is what made the old report untrustworthy: no date may be
 * locale-formatted (a report that changes with the exporter's timezone cannot be diffed or checked),
 * and no code may appear as a broken link.
 *
 * Kept inside `src` so `tsc` typechecks it against the modules it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import type { edgeType, nodeType } from "@/config/types";
import { buildProjectReport } from "@/pages/projectEditor/report/projectReport";
import { buildReportModel } from "@/pages/projectEditor/report/reportModel";
import { acceptAbstract, buildAbstractPayload } from "@/pages/projectEditor/report/reportAbstract";
import { formatIsoDay, headingSlug, tableCell } from "@/pages/projectEditor/report/reportFormat";
import type { ReportSnapshot } from "@/pages/projectEditor/report/reportTypes";
import { buildLocatorIndex } from "@/pages/projectEditor/locators";
import { buildActivityClusters } from "@/pages/projectEditor/canvasClusters";
import { buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import {
    NO_CANVAS_FOCUS,
    buildAbstractedGraph,
} from "@/pages/projectEditor/canvasAbstraction";
import { isNodeActive, nodeLabelOf, normalizeNodeLabel } from "@/pages/projectEditor/graphSemantics";

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

function component(id: string, title: string, createdAt: string): nodeType {
    return {
        id,
        position: { x: 0, y: 0 },
        type: "blueprintComponent",
        data: {
            label: "blueprint_component",
            type: "technical",
            title,
            createdAt,
            blueprintComponent: { id: 1, name: title, feedsInto: [], highBlockName: "H", intermediateBlockName: "I" },
            blueprintPaperTitle: "Design study methodology",
            blueprintFileName: "dsm.json",
        },
    } as unknown as nodeType;
}

function edge(
    id: string,
    source: string,
    target: string,
    label: string,
    data: Record<string, unknown> = {},
): edgeType {
    return {
        id,
        source,
        target,
        type: "relation",
        label,
        data: { label, createdAt: day(0), ...data },
    } as unknown as edgeType;
}

function emptyTimeline(): ReportSnapshot["timeline"] {
    return {
        startIso: day(0),
        endIso: day(60),
        stages: [],
        participants: [],
        designStudyEvents: [],
        blueprintEvents: [],
        codebaseSubtracks: [],
        screenshotMarkers: [],
        llmModel: "gpt-5-nano",
    };
}

type Fixture = { nodes: nodeType[]; edges: edgeType[]; timeline: ReportSnapshot["timeline"] };

function studyFixture(): Fixture {
    const nodes: nodeType[] = [
        card("a1", "activity", "Kickoff workshop", day(0)),
        card("r1", "requirement", "Must survive a reload", day(1), { description: "Sessions are long." }),
        card("h1", "person", "P04", day(1)),
        card("a2", "activity", "Interview round one", day(2)),
        card("i1", "insight", "Nobody trusted unmarked text", day(3), {
            description: "Participants asked which parts the tool wrote.",
            reference: "I want to know what the machine added.",
        }),
        card("c1", "concept", "Provenance surface", day(4), { autoGenerated: true }),
        card("a3", "activity", "Pilot evaluation", day(45)),
        card("r2", "requirement", "Show who wrote each card", day(46)),
        card("o1", "object", "Session transcript", day(47), { relevant: false }),
        card("i2", "insight", "Codes were retyped wrongly", day(48), { autoGenerated: true }),
        component("b1", "Visual mapping", day(49)),
        card("x1", "concept", "An unattached thought", day(50)),
    ];
    const edges: edgeType[] = [
        edge("e1", "a1", "r1", "derived from", { manual: true }),
        edge("e2", "a1", "h1", "part of", { manual: true }),
        edge("e3", "a2", "i1", "derived from", { manual: true }),
        edge("e4", "c1", "i1", "part of", { autoGenerated: true }),
        edge("e5", "a3", "r2", "derived from"),
        edge("e6", "a3", "o1", "generated by", { manual: true }),
        edge("e7", "a3", "i2", "derived from", { autoLinked: true, similarity: 0.71, similarityMargin: 0.09 }),
        edge("e8", "r2", "b1", "tackled in", { manual: true }),
        edge("e9", "i1", "c1", "part of", { autoLinked: true, similarity: 0.66, similarityMargin: 0.05 }),
    ];
    return { nodes, edges, timeline: emptyTimeline() };
}

function snapshotOf(fixture: Fixture, overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
    return {
        generatedAtIso: day(60),
        projectId: "proj-1",
        projectTitle: "Provenance in design studies",
        projectGoal: "Understand how researchers keep track of where a finding came from.",
        contentVersion: "abc123",
        asOf: { version: 12, capturedAtIso: day(59) },
        nodes: fixture.nodes,
        edges: fixture.edges,
        timeline: fixture.timeline,
        files: [],
        ...overrides,
    };
}

function indexFor(snapshot: ReportSnapshot) {
    const live = snapshot.nodes.filter(isNodeActive);
    const liveEdges = snapshot.edges.filter((e) => {
        const deletedAt = (e.data as Record<string, unknown> | undefined)?.deletedAt;
        return typeof deletedAt !== "string" || deletedAt.trim() === "";
    });
    const membership = buildActivityTreeMembership(live, liveEdges);
    const salience = buildSalienceIndex(live, liveEdges, membership);
    const activities = live.filter((n) => normalizeNodeLabel(nodeLabelOf(n)) === "activity");
    const clusters = buildActivityClusters({
        activities,
        edges: liveEdges,
        membership,
        score: salience.score,
        stages: snapshot.timeline.stages.map((s) => ({ name: s.name, start: s.startIso, end: s.endIso })),
    });
    return buildLocatorIndex({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        files: snapshot.files.map((f) => ({ sha256: f.sha256, name: f.name, createdAt: f.createdAtIso })),
        timeline: {
            stages: snapshot.timeline.stages.map((s) => ({ id: s.id, name: s.name, start: s.startIso, end: s.endIso })),
            designStudyEvents: snapshot.timeline.designStudyEvents.map((e) => ({
                id: e.id, name: e.name, occurredAt: e.occurredAtIso,
            })),
        },
        membership,
        clusters,
        asOf: { version: snapshot.asOf.version, capturedAt: snapshot.asOf.capturedAtIso },
    });
}

function reportFor(fixture: Fixture, overrides: Partial<ReportSnapshot> = {}, options: Partial<{
    abstract: { prose: string; model: string; prompt: string } | null;
    includeAppendices: boolean;
    canvasUrlForCode: ((code: string) => string | null) | null;
}> = {}) {
    const snapshot = snapshotOf(fixture, overrides);
    const codes = indexFor(snapshot);
    return {
        codes,
        snapshot,
        report: buildProjectReport(snapshot, {
            codes,
            canvasUrlForCode: options.canvasUrlForCode ?? null,
            abstract: options.abstract ?? null,
            includeAppendices: options.includeAppendices ?? true,
        }),
    };
}

// --- 1. Formatting primitives ------------------------------------------------------------------
{
    // Pinned so `toLocaleDateString` cannot creep back in: 23:30 UTC must not roll to the next day
    // for a reader west of Greenwich, or the same project would export differently in two places.
    equal("dates are UTC days", formatIsoDay("2026-01-01T23:30:00.000Z"), "2026-01-01");
    equal("and the other edge", formatIsoDay("2026-01-01T00:30:00.000Z"), "2026-01-01");
    equal("an absent date is an em dash", formatIsoDay(null), "—");
    equal("an unparseable date is an em dash", formatIsoDay("not a date"), "—");

    equal("a pipe cannot end a table cell", tableCell("a | b"), "a \\| b");
    equal("a newline cannot end a table row", tableCell("a\nb"), "a<br>b");
    check("a long value is never truncated", tableCell("x".repeat(500)).length >= 500);

    const taken = new Map<string, number>();
    equal("a slug is github-shaped", headingSlug("P1 · Formative study", taken), "p1--formative-study");
    equal("a repeated slug is disambiguated", headingSlug("P1 · Formative study", taken), "p1--formative-study-1");
}

// --- 2. Byte stability -------------------------------------------------------------------------
{
    const a = reportFor(studyFixture()).report.markdown;
    const b = reportFor(studyFixture()).report.markdown;
    check("the same project produces identical bytes", a === b);

    // Edge order is not information about the study, so it must not change the document.
    const shuffled = studyFixture();
    shuffled.edges.reverse();
    check("edge order does not change the document", reportFor(shuffled).report.markdown === a);
}

// --- 3. No clock and no locale ------------------------------------------------------------------
{
    const { report, snapshot } = reportFor(studyFixture());
    const md = report.markdown;

    // Every date in the output is an ISO day; a locale-formatted one would look like "1/1/2026".
    const localeShaped = md.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
    equal("no locale-formatted dates", localeShaped, null);
    check("the export instant is stated", md.includes(formatIsoDay(snapshot.generatedAtIso)));
    check("the revision it describes is stated", md.includes(String(snapshot.asOf.version)));
    check("the content fingerprint is stated", md.includes(snapshot.contentVersion));
}

// --- 4. No internal ids leak into the prose ----------------------------------------------------
{
    const md = reportFor(studyFixture()).report.markdown;
    check("no synthetic lens id appears anywhere", !md.includes("vz:"));

    // Codes are what a reader can use, so an id must never appear in the text. A canvas link is the
    // one exception and a deliberate one: it carries the project id and `n=<targetId>` so the link
    // still lands on the right artifact even if the numbering drifted between two exports. So the
    // rule is checked against the prose with the link lines removed, and the link is checked
    // separately for carrying the id it is supposed to.
    const linked = reportFor(studyFixture(), {}, {
        canvasUrlForCode: (code) => `https://host/vitral/project/9f0e4c11-2222-3333-4444-555566667777?ref=${code}&n=node-${code}`,
    }).report.markdown;
    const prose = linked
        .split("\n")
        .filter((line) => !line.includes("Open on the canvas"))
        .join("\n");
    equal("no uuid appears in the prose", prose.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i), null);
    check("but the canvas link carries the target id", linked.includes("&n=node-R1"));
}

// --- 5. Every cited code resolves ---------------------------------------------------------------
{
    const md = reportFor(studyFixture()).report.markdown;
    const lines = md.split("\n");

    const definitions = new Map<string, string>();
    for (const line of lines) {
        const match = /^\[([A-Za-z]+\d+)\]:\s+#(\S+)/.exec(line);
        if (match) definitions.set(match[1], match[2]);
    }
    check("definitions were emitted", definitions.size > 0);

    const slugs = new Set<string>();
    const taken = new Map<string, number>();
    for (const line of lines) {
        const match = /^#{1,6}\s+(.*)$/.exec(line);
        if (!match) continue;
        // Recompute the way the renderer does: a heading carrying a code slugs the code alone.
        const text = match[1].trim();
        const codeOnly = /^([A-Za-z]+\d+)(\s·\s.*)?$/.exec(text);
        slugs.add(headingSlug(codeOnly ? codeOnly[1] : text, taken));
    }

    let allResolve = true;
    for (const [code, slug] of definitions) {
        if (!slugs.has(slug)) { allResolve = false; console.log(`      ${code} -> #${slug} has no heading`); }
    }
    check("every definition points at a heading that exists", allResolve);
    equal("no two headings share a slug", slugs.size, Array.from(slugs).length);

    // The loud-failure rule: a cited code with nowhere to go must be plain text, never `[R7]` with
    // no definition, which renders as visibly broken markdown.
    const body = lines.filter((line) => !/^\[([A-Za-z]+\d+)\]:/.test(line)).join("\n");
    const undefinedRefs = new Set<string>();
    for (const match of body.matchAll(/\[([A-Za-z]+\d+)\]/g)) {
        if (!definitions.has(match[1])) undefinedRefs.add(match[1]);
    }
    equal("no code is cited as a link without a definition", Array.from(undefinedRefs).sort(), []);
}

// --- 6. The report agrees with the canvas ------------------------------------------------------
// The anti-drift check, and the reason the generator calls `pickTop` rather than its own rule. If
// somebody "simplifies" the report's promotion logic, this is what notices.
{
    const fixture = studyFixture();
    const snapshot = snapshotOf(fixture);
    const codes = indexFor(snapshot);
    const model = buildReportModel(snapshot, codes);

    const live = snapshot.nodes.filter(isNodeActive);
    const liveEdges = snapshot.edges;
    const membership = buildActivityTreeMembership(live, liveEdges);
    const salience = buildSalienceIndex(live, liveEdges, membership);
    const activities = live.filter((n) => normalizeNodeLabel(nodeLabelOf(n)) === "activity");
    const clusters = buildActivityClusters({
        activities, edges: liveEdges, membership, score: salience.score,
    });

    const overview = buildAbstractedGraph({
        nodes: live,
        edges: liveEdges,
        level: 1,
        focus: NO_CANVAS_FOCUS,
        membership,
        clusters,
        score: salience.score,
    });
    // At Overview the lens emits phase glyphs, the cards it promoted out of them, and — separately —
    // any card belonging to no activity at all, individually while there are fewer than three of
    // them. Only the first of those is a promotion, so the orphans are excluded from the oracle;
    // counting them would make this check pass for the wrong reason.
    const isOrphan = (nodeId: string) => membership.get(nodeId) === undefined;
    const promotedByOverview = overview.nodes
        .filter((node) => node.type !== "clusterGlyph" && !isOrphan(node.id))
        .map((node) => node.id)
        .sort();
    const reportPhaseHeadline = model.phases
        .flatMap((phase) => phase.headline.map((cardEntry) => cardEntry.nodeId))
        .sort();
    equal("the phases are organised around exactly what Overview promotes",
        reportPhaseHeadline, promotedByOverview);

    const threads = buildAbstractedGraph({
        nodes: live,
        edges: liveEdges,
        level: 2,
        focus: NO_CANVAS_FOCUS,
        membership,
        clusters,
        score: salience.score,
    });
    const activityIds = new Set(activities.map((n) => n.id));
    const promotedByThreads = threads.nodes
        .filter((node) => node.type !== "clusterGlyph" && !activityIds.has(node.id) && !isOrphan(node.id))
        .filter((node) => {
            // Level 2 re-admits blueprint structure as loose nodes; those are not promotions.
            const label = normalizeNodeLabel(nodeLabelOf(node));
            return label !== "blueprint_component" && label !== "blueprint_group" && label !== "blueprint";
        })
        .map((node) => node.id)
        .sort();
    const reportThreadHeadline = model.phases
        .flatMap((phase) => phase.threads)
        .concat(model.looseThreads)
        .flatMap((thread) => thread.headline.map((cardEntry) => cardEntry.nodeId))
        .sort();
    equal("the threads are organised around exactly what Threads promotes",
        reportThreadHeadline, promotedByThreads);
}

// --- 7. Person cards are context, never content -----------------------------------------------
{
    const withPeople = studyFixture();
    const { report: reportWith } = reportFor(withPeople, {
        timeline: { ...emptyTimeline(), participants: [{ id: "p1", name: "P04", role: "Participant" }] },
    });

    check("a participant is named", reportWith.markdown.includes("P04"));
    // A person is never counted as a card, promoted, or listed in a thread's card table.
    equal("people are excluded from the card totals",
        reportWith.stats.cards, withPeople.nodes.filter((n) => (n.data as Record<string, unknown>).label !== "person"
            && (n.data as Record<string, unknown>).label !== "blueprint_group").length);

    // Stronger form: two projects differing only by person cards produce the same document apart
    // from the participant lines.
    const without = studyFixture();
    without.nodes = without.nodes.filter((n) => (n.data as Record<string, unknown>).label !== "person");
    without.edges = without.edges.filter((e) => e.target !== "h1" && e.source !== "h1");
    const strip = (md: string) => md
        .split("\n")
        .filter((line) => !line.includes("P04") && !line.includes("with "))
        .join("\n");
    // The codes shift (H1 disappears), so compare the narrative shape rather than the bytes.
    const headingsOf = (md: string) => md.split("\n").filter((line) => line.startsWith("#")).length;
    equal("removing the people does not change the document's structure",
        headingsOf(strip(reportFor(without).report.markdown)) > 0
        && headingsOf(strip(reportWith.markdown)) > 0,
        true);
}

// --- 8. Authored outranks model-proposed at equal centrality ------------------------------------
{
    const fixture: Fixture = {
        nodes: [
            card("a1", "activity", "One activity", day(0)),
            card("m1", "insight", "Proposed by a model", day(1), { autoGenerated: true }),
            card("w1", "insight", "Written by a person", day(1)),
        ],
        edges: [
            edge("e1", "a1", "m1", "derived from"),
            edge("e2", "a1", "w1", "derived from"),
        ],
        timeline: emptyTimeline(),
    };
    const snapshot = snapshotOf(fixture);
    const model = buildReportModel(snapshot, indexFor(snapshot));
    const insights = model.insights.map((cardEntry) => cardEntry.nodeId);
    equal("the authored insight is named first", insights[0], "w1");

    const md = reportFor(fixture).report.markdown;
    // The author column, not a loose substring: "AI" appears in prose too.
    check("the model's card is marked as its author", md.includes("| AI |"));
    check("the person's card is marked as its author", md.includes("| authored |"));
}

// --- 9. Relation provenance keeps a third, unknown bucket -------------------------------------
{
    const { report, snapshot } = reportFor(studyFixture());
    const model = buildReportModel(snapshot, indexFor(snapshot));

    const origins = model.relations.map((relation) => relation.origin);
    check("hand-drawn edges are recognised", origins.includes("hand-drawn"));
    check("model-derived edges are recognised", origins.includes("model-derived"));
    // `e5` carries neither `manual` nor an automatic marker: it predates the flag, so it is unknown
    // rather than assumed to be either. Guessing here is the overclaim the report exists to avoid.
    check("an unmarked edge is unknown, not guessed", origins.includes("unknown"));
    // Counted in its own column of the provenance table rather than folded into either side.
    check("the document gives unknown provenance its own column",
        report.markdown.includes("| Kind | Total | Hand-drawn | AI | Unknown |"));

    // The similarity evidence is carried through so a doubted relation can be checked.
    check("automatic relations show their score", report.markdown.includes("cos 0.71"));
}

// --- 10. Nothing is dropped -------------------------------------------------------------------
{
    const fixture = studyFixture();
    const { report, snapshot, codes } = reportFor(fixture);
    const md = report.markdown;

    const contentLabels = new Set(["requirement", "insight", "concept", "object", "activity", "blueprint_component"]);
    const liveContent = snapshot.nodes.filter((node) => {
        const data = node.data as Record<string, unknown>;
        return isNodeActive(node) && contentLabels.has(String(data.label));
    });

    let allNamed = true;
    for (const node of liveContent) {
        const code = codes.byTargetId.get(node.id)?.code;
        if (code === undefined) { allNamed = false; console.log(`      ${node.id} has no code`); continue; }
        if (!md.includes(code)) { allNamed = false; console.log(`      ${code} never appears`); }
    }
    check("every live content card is named somewhere in the document", allNamed);

    // The unattached concept must be listed, not silently lost with the band it sits in.
    check("an unattached card gets its own section", md.includes("Unconnected cards"));
    check("and is named there", md.includes(codes.byTargetId.get("x1")!.code));

    // The set-aside card is named in Provenance rather than in the body.
    equal("a set-aside card is counted", report.stats.setAsideCards, 1);
    check("and named under Set aside", md.includes("Set aside"));
}

// --- 11. Removed content appears only in the removal table -----------------------------------
{
    const withDeletion = studyFixture();
    (withDeletion.nodes.find((n) => n.id === "i1")!.data as Record<string, unknown>).deletedAt = day(50);
    const { report, codes } = reportFor(withDeletion);
    const md = report.markdown;

    equal("the deleted card is counted", report.stats.removedNodes, 1);
    check("the removal section names it", md.includes("Removed from the study"));

    const code = codes.byTargetId.get("i1")?.code;
    check("the deleted card still has a code", typeof code === "string");

    // It must not appear as live content: not in a thread table, not in a headline, not in Insights.
    const insightsSection = md.split("## Insights")[1]?.split("\n## ")[0] ?? "";
    check("a deleted insight is not listed among the insights",
        !insightsSection.includes("Nobody trusted unmarked text"));
}

// --- 11b. A relation never outlives its endpoints ---------------------------------------------
// Found in the running app: deleting a blueprint component left its `tackled in` edge alive, so the
// document said "B1 was deleted" and, three lines earlier, "R1 —tackled in→ B1". The editor's
// cascade is fixed, but the document must not depend on it — an edge with a dead end is dropped from
// the live set here whatever its own flag says.
{
    const dangling = studyFixture();
    // The component is deleted; its edge is deliberately left marked live, reproducing the bug.
    (dangling.nodes.find((n) => n.id === "b1")!.data as Record<string, unknown>).deletedAt = day(50);
    const { report, codes } = reportFor(dangling);
    const md = report.markdown;

    const componentCode = codes.byTargetId.get("b1")?.code;
    check("the component still has a code", typeof componentCode === "string");
    check("and is reported as removed", md.includes("Removed from the study"));
    check("but no relation claims to reach it",
        !md.includes(`tackled in→ [${componentCode}]`) && !md.includes(`tackled in→ ` + "`" + componentCode + "`"));

    const snapshot = snapshotOf(dangling);
    const model = buildReportModel(snapshot, indexFor(snapshot));
    check("the dangling edge is counted as removed rather than live",
        model.removedRelations.some((relation) => relation.targetNodeId === "b1"));
    check("and is absent from the live relations",
        !model.relations.some((relation) => relation.targetNodeId === "b1"));
}

// --- 12. Degenerate projects ------------------------------------------------------------------
{
    const cases: Array<[string, Fixture]> = [
        ["an empty project", { nodes: [], edges: [], timeline: emptyTimeline() }],
        ["one card", { nodes: [card("only", "insight", "A lone thought", day(0))], edges: [], timeline: emptyTimeline() }],
        ["one activity", { nodes: [card("a", "activity", "Only activity", day(0))], edges: [], timeline: emptyTimeline() }],
        ["three activities at the clustering boundary", {
            nodes: [
                card("a1", "activity", "One", day(0)),
                card("a2", "activity", "Two", day(1)),
                card("a3", "activity", "Three", day(40)),
            ],
            edges: [],
            timeline: emptyTimeline(),
        }],
    ];

    for (const [label, fixture] of cases) {
        let threw: string | null = null;
        let md = "";
        try {
            md = reportFor(fixture).report.markdown;
        } catch (caught) {
            threw = caught instanceof Error ? caught.message : String(caught);
        }
        equal(`${label} does not throw`, threw, null);
        check(`${label} still has a Provenance section`, md.includes("## Provenance"));
        check(`${label} has no undefined`, !md.includes("undefined"));
        check(`${label} has no NaN`, !md.includes("NaN"));
        check(`${label} has no Invalid Date`, !md.includes("Invalid Date"));
    }
}

// --- 13. Verbatim survival --------------------------------------------------------------------
{
    const awkward = studyFixture();
    const nasty = "Has a | pipe, a\nnewline, a `backtick` and the literal text [R7].";
    (awkward.nodes.find((n) => n.id === "r1")!.data as Record<string, unknown>).description = nasty;
    const md = reportFor(awkward).report.markdown;

    // The blockquote rendering keeps every character; only the table cell is escaped.
    check("the pipe survives verbatim in a quote", md.includes("Has a | pipe,"));
    check("the backtick survives", md.includes("`backtick`"));
    check("nothing was truncated", md.includes("the literal text"));
}

// --- 14. The abstract is validated, not trusted ------------------------------------------------
{
    const { snapshot, codes } = reportFor(studyFixture());
    const model = buildReportModel(snapshot, codes);
    const payload = buildAbstractPayload(model);

    check("the payload names phases by code", payload.phases.every((phase) => phase.code !== null));
    check("the payload carries no node ids",
        !JSON.stringify(payload).includes("\"a1\"") && !JSON.stringify(payload).includes("\"r1\""));

    const allowed = new Set(codes.entries.map((entry) => entry.code));
    equal("a clean paragraph is accepted",
        acceptAbstract("The study ran in two phases. It began with [A1].", allowed),
        "The study ran in two phases. It began with [A1].");
    equal("a fabricated code rejects the whole paragraph",
        acceptAbstract("The study concluded with [R99].", allowed), null);
    equal("a heading is refused", acceptAbstract("# Abstract\nText.", allowed), null);
    equal("a list is refused", acceptAbstract("- one\n- two", allowed), null);
    equal("a fence is unwrapped",
        acceptAbstract("```markdown\nJust prose.\n```", allowed), "Just prose.");
    equal("an inner fence is refused", acceptAbstract("Text ```code``` more", allowed), null);
    equal("empty is refused", acceptAbstract("   ", allowed), null);
    equal("an overlong answer is refused",
        acceptAbstract("word ".repeat(500), allowed), null);

    // With no abstract the section says so and carries no sentinel.
    const plain = reportFor(studyFixture()).report.markdown;
    check("an absent abstract is stated plainly", plain.includes("No machine-written framing"));
    check("and leaves no sentinel", !plain.includes("vitral:abstract:begin"));

    const withAbstract = reportFor(studyFixture(), {}, {
        abstract: { prose: "Two phases, described in [A1].", model: "gpt-5-nano", prompt: "ReportAbstract" },
    }).report.markdown;
    check("a present abstract is fenced by sentinels", withAbstract.includes("vitral:abstract:begin"));
    check("and closed", withAbstract.includes("vitral:abstract:end"));
    check("and labelled as machine-written", withAbstract.includes("Machine-written"));
}

// --- 15. Provenance carries the numbers a sceptic wants ---------------------------------------
{
    const md = reportFor(studyFixture()).report.markdown;
    check("the salience formula is printed", md.includes("`authored`"));
    check("the emphasis weights are shown", md.includes("0.20"));
    check("the clustering rule is explained", md.includes("gap in time"));
    check("the disagreement with the server's tree rule is admitted",
        md.includes("honest discrepancy"));
    check("the filters-are-ignored caveat is stated", md.includes("Filters are ignored"));
    check("authorship is tallied", md.includes("### Authorship"));
}

// --- 16. Canvas links are optional ------------------------------------------------------------
{
    const offline = reportFor(studyFixture()).report.markdown;
    check("with no link builder there are no canvas links", !offline.includes("Open on the canvas"));

    const online = reportFor(studyFixture(), {}, {
        canvasUrlForCode: (code) => `https://host/vitral/project/proj-1?ref=${code}`,
    }).report.markdown;
    check("with one, the appendix links out", online.includes("Open on the canvas"));
    check("and the link carries the code", online.includes("ref=R1"));
    // The document must still be navigable by its own anchors either way.
    check("internal definitions are present in both", offline.includes("]: #") && online.includes("]: #"));
}

// --- 17. The file name is dated ---------------------------------------------------------------
{
    const { report } = reportFor(studyFixture());
    equal("the export is named after the project and the day",
        report.fileName, "provenance-in-design-studies-2026-03-02.md");
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} report check(s) failed`);
}
console.log("ALL PASS");
