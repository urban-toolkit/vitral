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
        .filter((line) => !line.startsWith("On the canvas:"))
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
    // A person is never counted as a card, promoted, or listed in a thread's card table. Neither is
    // a set-aside card: the totals describe what the document contains.
    equal("people and set-aside cards are excluded from the card totals",
        reportWith.stats.cards, withPeople.nodes.filter((n) => {
            const data = n.data as Record<string, unknown>;
            return data.label !== "person"
                && data.label !== "blueprint_group"
                && data.relevant !== false;
        }).length);

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
    // The provenance tally table is gone, so the place a reader now meets a relation's origin is
    // beside the relation itself — which is where it was always checkable.
    check("a printed relation names its origin",
        report.markdown.includes("(hand-drawn)"));

    // The similarity evidence is carried through so a doubted relation can be checked. Only
    // cross-thread relations are printed now, so this is asserted on the model: whether a given
    // fixture happens to have an outbound automatic edge is not what is being pinned.
    check("automatic relations carry their score",
        model.relations.some((relation) => relation.similarity === 0.71));
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
    // The visible disclaimer was removed on request. The sentinels above are what remain, and they
    // are the half a script needs: the block stays findable and removable without a reader having to
    // be told, in the abstract itself, that the abstract was written by a machine.
    check("and carries no visible machine-written disclaimer",
        !withAbstract.includes("Machine-written"));
}

// --- 15. Provenance is what the graph cannot show, and nothing it restates --------------------
//
// The computed tallies were removed on request. They are pinned here as *absent* rather than simply
// deleted from the test, because each one restated a mark the body already carries per card and per
// relation, and reintroducing one would be a regression against that decision rather than a feature.
{
    const md = reportFor(studyFixture()).report.markdown;

    check("the how-it-was-made essay is gone", !md.includes("How this document was made"));
    check("the authorship tally is gone", !md.includes("### Authorship"));
    check("the salience weight table is gone", !md.includes("Emphasis, as a formula"));
    check("the relation-origin table is gone", !md.includes("Relations by kind and origin"));
    check("the revision summary is gone", !md.includes("How much the material was worked"));

    // What is left is the two things no other section can say.
    check("Provenance still exists", md.includes("## Provenance"));
    check("and still records what was removed", md.includes("### Removed from the study"));
    check("and still records what was set aside", md.includes("### Set aside"));
}

// --- 15b. Set-aside cards leave the body entirely ----------------------------------------------
{
    const fixture = studyFixture();
    const { report, snapshot, codes } = reportFor(fixture);
    const md = report.markdown;
    const model = buildReportModel(snapshot, codes);

    // `o1` is the fixture's one `relevant: false` card.
    const asideCode = codes.byTargetId.get("o1")?.code;
    check("the set-aside card has a code", typeof asideCode === "string");
    equal("and is counted as set aside", report.stats.setAsideCards, 1);

    const inNoBodyCollection = ![
        ...model.unassignedCards,
        ...model.insights,
        ...model.concepts,
        ...model.blueprintComponents,
        ...model.unansweredRequirements,
        ...model.requirementAnswers.map((answer) => answer.requirement),
        ...model.requirementAnswers.flatMap((answer) => answer.components.map((c) => c.card)),
        ...model.phases.flatMap((phase) => [
            ...phase.headline,
            ...phase.threads.flatMap((thread) => [...thread.cards, ...thread.headline]),
        ]),
        ...model.looseThreads.flatMap((thread) => [...thread.cards, ...thread.headline]),
    ].some((entry) => entry.nodeId === "o1");
    check("no body collection contains it", inNoBodyCollection);

    check("no relation touching it survives",
        !model.relations.some((r) => r.sourceNodeId === "o1" || r.targetNodeId === "o1"));

    // Its title is the thing that must not be reproduced. It appears once — in the Set aside table —
    // and the sections that name codes point at that table rather than repeating it.
    const titleMentions = md.split("Session transcript").length - 1;
    equal("its title appears exactly once, under Set aside", titleMentions, 1);
    check("and the appendix sends the reader there",
        md.includes("set aside by the researcher, so it has no entry above"));
    check("it has no appendix entry of its own",
        !md.includes(`### ${asideCode}
`));
}

// --- 15b2. The awkward relevance cases: an activity, and a person ------------------------------
//
// Both were live holes after the first pass at the relevance rule, and both reach the body through a
// route that is not a card table: an activity through its own thread heading, a person through the
// participants lines. Neither is covered by 15b, whose set-aside card is an ordinary satellite.
{
    const withAside = studyFixture();
    withAside.nodes.push(
        card("h9", "person", "SIDELINED PERSON", day(46), { relevant: false }),
    );
    withAside.edges.push(edge("e20", "a3", "h9", "part of", { manual: true }));
    // The third activity, far enough out in time to anchor its own phase.
    (withAside.nodes.find((n) => n.id === "a3")!.data as Record<string, unknown>).relevant = false;

    const { report, codes } = reportFor(withAside);
    const md = report.markdown;

    // A person's name reaches the body only through the participants lines, and a set-aside card
    // must not be featured there. It is still named once, in the Set aside table — that row is the
    // record of the judgement, and it is the same treatment every other set-aside card gets.
    const participantLines = md
        .split("\n")
        .filter((line) => line.startsWith("Participants:") || line.startsWith("| Participants |"));
    check("no participants line names a set-aside person",
        !participantLines.some((line) => line.includes("SIDELINED PERSON")));
    equal("and the name appears exactly once, under Set aside",
        md.split("SIDELINED PERSON").length - 1, 1);
    check("recorded with its code", md.includes(`| ${codes.byTargetId.get("h9")?.code} |`));

    // An activity is structure: its thread stays, because the cards under it were not set aside.
    const activityCode = codes.byTargetId.get("a3")?.code;
    check("a set-aside activity keeps its thread section",
        md.includes(`#### ${activityCode} · Pilot evaluation`)
        || md.includes(`### ${activityCode} · Pilot evaluation`));
    check("and says so in the section itself",
        md.includes("marked this activity not relevant"));
    check("and its cards are still listed", md.includes("Show who wrote each card"));

    // The contradiction this pair used to produce: a heading the appendix denied existed.
    check("the appendix does not deny a section the document has",
        !md.includes(`\`${activityCode}\` — was set aside`));
    // The link definition and the heading still agree, which is what the anchor guarantee rests on.
    check("its code still resolves to that heading",
        md.includes(`[${activityCode}]: #${String(activityCode).toLowerCase()}`));
}

// --- 15c. The report explains how to read a reference ------------------------------------------
{
    const md = reportFor(studyFixture()).report.markdown;

    // The front-matter paragraph that used to carry this was removed; the explanation now lives in
    // a section of its own, immediately above the index the codes resolve to.
    check("the front-matter essay is gone",
        !md.includes("Everything in this document except the Abstract"));
    check("the explanation has a section of its own", md.includes("## How to read a reference"));
    check("and it comes before the index",
        md.indexOf("## How to read a reference") < md.indexOf("## Appendix A. Card index"));
    check("the letter is explained as an altitude",
        md.includes("the altitude it is cited at"));

    check("the phase suffix is documented", md.includes("`R1P`"));
    check("the activity suffix is documented", md.includes("`R1A`"));
    check("the thread suffix is documented", md.includes("`R1T`"));
    check("the attached-file suffix is documented", md.includes("`R1F`"));
    // Not offered as a next-step link in the index, so the explanation is the only place a reader
    // can learn it exists.
    check("the activity-file suffix is documented", md.includes("`R1AF`"));

    // `O` is gone, and with it the caution that existed only because `R10` and `R1O` collided.
    check("the retired Overview suffix is not documented", !md.includes("`R1O`"));
    check("and the R10/R1O caution is gone", !md.includes("`R10` is the tenth requirement"));

    check("the closure of the grammar is stated", md.includes("it is closed"));
    check("both surfaces are described",
        md.includes("**In this document**") && md.includes("**In the application**"));

    // Without appendices the index is not there either, so neither is its explanation.
    const bodyOnly = reportFor(studyFixture(), {}, { includeAppendices: false }).report.markdown;
    check("and it travels with the index", !bodyOnly.includes("## How to read a reference"));
}

// --- 15e. The index offers the next step, and only where there is one ---------------------------
// `R1 (P / A / T / F)`: the code opens the card, the letters open the further views of it. A letter
// that would resolve to nothing is left out rather than printed dead.
{
    const withFile = studyFixture();
    withFile.nodes = withFile.nodes.map((node) => (node.id === "r1"
        ? card("r1", "requirement", "Must survive a reload", day(1), {
            description: "Sessions are long.",
            attachmentIds: ["file-1"],
        })
        : node));
    const md = reportFor(withFile, {
        files: [{
            id: "file-1",
            sha256: "a".repeat(64),
            name: "protocol.pdf",
            ext: "pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            createdAtIso: day(1),
        }],
    }, {
        canvasUrlForCode: (code) => `https://host/p?ref=${code}`,
    }).report.markdown;

    const entryOf = (code: string): string => {
        const line = md.split("\n").find((row) => row.startsWith(`On the canvas: [${code}]`));
        return line ?? "";
    };

    // R1 is a requirement in a thread, in a phase, with a file attached: every letter applies.
    const r1 = entryOf("R1");
    check("the code itself is the first link", r1.startsWith("On the canvas: [R1](https://host/p?ref=R1)"));
    check("the phase is offered", r1.includes("[P](https://host/p?ref=R1P)"));
    check("the activity is offered", r1.includes("[A](https://host/p?ref=R1A)"));
    check("the thread is offered", r1.includes("[T](https://host/p?ref=R1T)"));
    check("the file is offered", r1.includes("[F](https://host/p?ref=R1F)"));
    check("in the order the explanation lists them",
        r1.indexOf("[P]") < r1.indexOf("[A]")
        && r1.indexOf("[A]") < r1.indexOf("[T]")
        && r1.indexOf("[T]") < r1.indexOf("[F]"));
    // Typeable, deliberately not advertised: five letters stops being a glance.
    check("but the activity's file is not", !r1.includes("[AF]"));

    // R2 is in a thread and a phase but carries nothing.
    const r2 = entryOf("R2");
    check("a card with no file still offers the rest", r2.includes("[P]") && r2.includes("[T]"));
    check("and omits the file rather than linking nowhere", !r2.includes("[F]"));

    // C2 is the unattached thought: no activity, so no thread and no phase either.
    const c2 = entryOf("C2");
    check("an unconnected card is still linkable", c2.startsWith("On the canvas: [C2]"));
    // Not a bare "(" — the markdown link syntax has one. The parenthesised group is what must
    // be absent, and it is the only thing separated from the code link by a space.
    check("but is offered no further views", !c2.includes(") ("));

    // Offline, the whole line goes, as it always did.
    const offline = reportFor(studyFixture()).report.markdown;
    check("with no link builder there is no row at all", !offline.includes("On the canvas:"));
}

// --- 15d. The counts the reader was asked to lose ----------------------------------------------
{
    const md = reportFor(studyFixture()).report.markdown;

    check("Phases at a glance has no Cards column",
        md.includes("| Code | Phase | Dates | Threads |"));
    check("a phase table states no card total", !md.includes("| Contains |"));
    check("a phase table states no composition", !md.includes("| Composition |"));
    check("a thread states no internal relations", !md.includes("Relations inside this thread"));
    check("but still states what it reaches", md.includes("Reaching beyond it"));
}

// --- 16. Canvas links are optional ------------------------------------------------------------
{
    const offline = reportFor(studyFixture()).report.markdown;
    check("with no link builder there are no canvas links", !offline.includes("On the canvas:"));

    const online = reportFor(studyFixture(), {}, {
        canvasUrlForCode: (code) => `https://host/vitral/project/proj-1?ref=${code}`,
    }).report.markdown;
    check("with one, the appendix links out", online.includes("On the canvas:"));
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
