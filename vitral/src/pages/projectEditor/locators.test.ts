/**
 * Properties of the shared code system. Run with `npm run test:locators`.
 *
 * What is pinned here is not any particular numbering but the promise a printed code makes: adding to
 * a project may only ever *add* codes. Two of these checks exist because the obvious implementations
 * fail them — a code derived from `createdAt` breaks when a date is corrected, and a code derived from
 * the first `__history` entry breaks when a card is created while the playhead is scrubbed into the
 * past, because `resolveActionTimestamp()` stamps that card with a past instant. Both would renumber
 * silently, which is worse than breaking: a paper citing `R7` would quietly point at a different card.
 *
 * The phase check is deliberately partial, and the omission is the contract: a phase is recomputed
 * from the project's own timing and content, so a phase code promises its anchor activity and nothing
 * about the phase's extent.
 *
 * Kept inside `src` so `tsc` typechecks it against the modules it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import type { edgeType, nodeType } from "@/config/types";
import {
    LOCATOR_KIND_LETTER,
    LOCATOR_KIND_LEVEL,
    LOCATOR_LETTER_KIND,
    buildLocatorIndex,
    codeToAnchor,
    codeToUrl,
    describeLocatorStatus,
    formatLocatorCode,
    isLocatableId,
    nodeToCode,
    parseLocatorCode,
    planLocatorAssignments,
    type LocatorIndex,
    type LocatorKind,
} from "@/pages/projectEditor/locators";
import { buildActivityClusters } from "@/pages/projectEditor/canvasClusters";
import { buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import { SYNTHETIC_ID_PREFIX } from "@/pages/projectEditor/canvasAbstraction";

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

/** Deterministic ISO instants, one day apart, so no test depends on a real clock. */
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
            // Seeded the way `ensureNodeHistory` seeds it: one data snapshot, one position snapshot.
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
            blueprintPaperTitle: "A paper",
            blueprintFileName: "a.json",
        },
    } as unknown as nodeType;
}

function groupBox(id: string, title: string): nodeType {
    return {
        id,
        position: { x: 0, y: 0 },
        type: "blueprintGroup",
        data: {
            label: "blueprint_group",
            type: "technical",
            title,
            blueprintGroupLevel: "paper",
            blueprintPaperTitle: "A paper",
            blueprintFileName: "a.json",
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

/** Three activities with a clear time gap between the second and third, plus a card on each. */
function studyFixture(): Fixture {
    const nodes: nodeType[] = [
        card("a1", "activity", "Kickoff", day(0)),
        card("r1", "requirement", "Must survive a reload", day(1)),
        card("a2", "activity", "Interviews", day(2)),
        card("i1", "insight", "Nobody trusted unmarked text", day(3)),
        card("a3", "activity", "Pilot evaluation", day(40)),
        card("c1", "concept", "Provenance surface", day(41)),
        card("h1", "person", "P04", day(41)),
        component("b1", "Visual mapping", day(42)),
        groupBox("g1", "A paper"),
    ];
    const edges: edgeType[] = [
        edge("e1", "a1", "r1", "derived from"),
        edge("e2", "a2", "i1", "derived from"),
        edge("e3", "a3", "c1", "relevant to"),
        edge("e4", "a3", "h1", "part of"),
        edge("e5", "r1", "b1", "tackled in"),
    ];
    return { nodes, edges };
}

function indexOf(fixture: Fixture, files: Array<{ sha256: string; name: string; createdAt: string }> = []): LocatorIndex {
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
        files,
        timeline: { stages: [], designStudyEvents: [] },
        membership,
        clusters,
        asOf: { version: 7, capturedAt: day(50) },
    });
}

// --- 1. Grammar round trip ----------------------------------------------------------------------
{
    const kinds = Object.keys(LOCATOR_KIND_LETTER) as LocatorKind[];
    let roundTripped = 0;
    let injective = true;
    const seen = new Set<string>();
    for (const kind of kinds) {
        for (let ordinal = 1; ordinal <= 50; ordinal += 1) {
            const code = formatLocatorCode(kind, ordinal);
            if (seen.has(code)) injective = false;
            seen.add(code);
            const parsed = parseLocatorCode(code);
            if (parsed && parsed.kind === kind && parsed.ordinal === ordinal && parsed.code === code) {
                roundTripped += 1;
            }
        }
    }
    equal("every code round trips through parse", roundTripped, kinds.length * 50);
    check("codes are unique across kinds and ordinals", injective);
    equal("letters and kinds are a bijection",
        Object.keys(LOCATOR_LETTER_KIND).length, kinds.length);
}

// --- 2. Input tolerance -------------------------------------------------------------------------
{
    equal("lowercase parses", parseLocatorCode("a3")?.code, "A3");
    equal("surrounding space parses", parseLocatorCode("  A3 ")?.code, "A3");
    equal("leading zeros on the ordinal parse", parseLocatorCode("A03")?.code, "A3");
    equal("a zero read for an O is repaired", parseLocatorCode("03")?.code, "O3");
    equal("a one read for an I is repaired", parseLocatorCode("13")?.code, "I3");
    equal("a five read for an S is repaired", parseLocatorCode("53")?.code, "S3");
    equal("an eight read for a B is repaired", parseLocatorCode("83")?.code, "B3");
    // Repair is first-character only, so a digit inside the ordinal is never touched.
    equal("A03 is ordinal three, not an O", parseLocatorCode("A03")?.kind, "activity");
    equal("an unknown letter is refused", parseLocatorCode("Q9"), null);
    equal("a bare letter is refused", parseLocatorCode("A"), null);
    equal("a bare number is refused", parseLocatorCode("7"), null);
    equal("ordinal zero is refused", parseLocatorCode("A0"), null);
    equal("a non-string is refused", parseLocatorCode(42), null);
    equal("empty is refused", parseLocatorCode("   "), null);
}

// --- 3. The level table is total, and the index agrees with it ----------------------------------
{
    const kinds = Object.keys(LOCATOR_KIND_LETTER) as LocatorKind[];
    let total = true;
    for (const kind of kinds) {
        const level = LOCATOR_KIND_LEVEL[kind];
        if (level !== 1 && level !== 2 && level !== 3) total = false;
    }
    check("every kind has a canvas level", total);
    equal("a phase is an Overview claim", LOCATOR_KIND_LEVEL.phase, 1);
    equal("a stage is an Overview claim", LOCATOR_KIND_LEVEL.stage, 1);
    equal("a thread is a Threads claim", LOCATOR_KIND_LEVEL.activity, 2);
    equal("an event is a Threads claim", LOCATOR_KIND_LEVEL.event, 2);
    equal("a requirement is a Detail claim", LOCATOR_KIND_LEVEL.requirement, 3);
    equal("a component is a Detail claim", LOCATOR_KIND_LEVEL.blueprintComponent, 3);

    const index = indexOf(studyFixture());
    let agrees = true;
    for (const entry of index.entries) {
        if (entry.level !== LOCATOR_KIND_LEVEL[entry.locator.kind]) agrees = false;
    }
    check("every entry carries the level its letter claims", agrees);
}

// --- 4. The index names what it should, and nothing it should not -------------------------------
{
    const index = indexOf(studyFixture(), [
        { sha256: "aaa", name: "transcript.pdf", createdAt: day(5) },
    ]);

    equal("the first activity is A1", nodeToCode(index, "a1"), "A1");
    equal("the third activity is A3", nodeToCode(index, "a3"), "A3");
    equal("the requirement is R1", nodeToCode(index, "r1"), "R1");
    equal("the insight is I1", nodeToCode(index, "i1"), "I1");
    equal("the concept is C1", nodeToCode(index, "c1"), "C1");
    equal("a person card is H1, not P1", nodeToCode(index, "h1"), "H1");
    equal("the blueprint component is B1", nodeToCode(index, "b1"), "B1");
    equal("a file is coded by its hash", index.byCode.get("F1")?.targetId, "aaa");

    equal("a group box gets no code", nodeToCode(index, "g1"), null);
    check("P is a phase, never a person",
        index.byCode.get("P1")?.describedAs === "phase");

    let noSynthetic = true;
    for (const entry of index.entries) {
        if (entry.targetId.startsWith(SYNTHETIC_ID_PREFIX)) noSynthetic = false;
        if (String(entry.viewpoint.focus.clusterId ?? "").startsWith("vz:c:") === false
            && entry.locator.kind === "phase") noSynthetic = false;
    }
    check("no locator points at a lens-invented id", noSynthetic);
    check("isLocatableId refuses a synthetic id", !isLocatableId("vz:c:a1"));
    check("isLocatableId accepts a node id", isLocatableId("a1"));

    // Every code in the index is unique, and resolvable.
    const codes = index.entries.map((entry) => entry.code);
    equal("codes are unique within a document", new Set(codes).size, codes.length);
}

// --- 5. Focus+Context: the code chooses the altitude -------------------------------------------
{
    const index = indexOf(studyFixture());

    const phase = index.byCode.get("P1");
    equal("a phase opens itself and nothing deeper", phase?.viewpoint.focus.activityId, null);
    check("a phase focuses a cluster", (phase?.viewpoint.focus.clusterId ?? "").startsWith("vz:c:"));
    equal("a phase resolves at Overview", phase?.viewpoint.level, 1);
    check("a phase points at a persisted anchor node", isLocatableId(phase?.targetId));

    const thread = index.byCode.get("A2");
    equal("a thread focuses itself", thread?.viewpoint.focus.activityId, "a2");
    check("a thread also carries its phase", thread?.viewpoint.focus.clusterId !== null);

    const requirement = index.byCode.get("R1");
    equal("a card focuses its own thread", requirement?.viewpoint.focus.activityId, "a1");
    equal("a card is the node to centre", requirement?.viewpoint.nodeId, "r1");
    equal("a card keeps the base level at Overview so its siblings stay abstract",
        requirement?.viewpoint.level, 1);

    // A component belongs to no thread by design, so it cannot pretend to.
    const componentTarget = index.byCode.get("B1");
    equal("a component resolves at Detail", componentTarget?.viewpoint.level, 3);
    equal("a component claims no thread", componentTarget?.viewpoint.focus.activityId, null);
}

// --- 6. Append-only under a plain append -------------------------------------------------------
{
    const before = indexOf(studyFixture());
    const grown = studyFixture();
    grown.nodes.push(card("r9", "requirement", "A late requirement", day(60)));
    grown.edges.push(edge("e9", "a3", "r9", "derived from"));
    const after = indexOf(grown);

    let stable = true;
    for (const entry of before.entries) {
        if (entry.locator.kind === "phase") continue;
        if (after.byCode.get(entry.code)?.targetId !== entry.targetId) stable = false;
    }
    check("adding a card leaves every existing code pointing at the same target", stable);
    equal("the new card takes the next free ordinal", nodeToCode(after, "r9"), "R2");
}

// --- 7. Append-only under a BACK-DATED creation ------------------------------------------------
// The decisive case. `resolveActionTimestamp()` returns the playhead, so a card created while the
// timeline is scrubbed back is stamped with a past instant and its first `__history` entry precedes
// every existing node's. Any ordering keyed on time would insert it in the middle and renumber
// everything after it. Position in the stored array is what makes this test pass.
{
    const before = indexOf(studyFixture());
    const grown = studyFixture();
    grown.nodes.push(card("r0", "requirement", "Written while scrubbed back", day(-30)));
    grown.edges.push(edge("e0", "a1", "r0", "derived from"));
    const after = indexOf(grown);

    let stable = true;
    const drifted: string[] = [];
    for (const entry of before.entries) {
        if (entry.locator.kind === "phase") continue;
        if (after.byCode.get(entry.code)?.targetId !== entry.targetId) {
            stable = false;
            drifted.push(entry.code);
        }
    }
    check(
        "a card created with a back-dated timestamp renumbers nothing"
        + (drifted.length > 0 ? ` — drifted: ${drifted.join(", ")}` : ""),
        stable,
    );
    equal("the back-dated card still takes the next free ordinal", nodeToCode(after, "r0"), "R2");
}

// --- 8. Append-only under a corrected date ------------------------------------------------------
{
    const before = indexOf(studyFixture());
    const edited = studyFixture();
    const target = edited.nodes.find((node) => node.id === "r1")!;
    const data = target.data as Record<string, unknown>;
    // What `updateNode` does: `createdAt` changes and a new history entry is APPENDED. Entry zero,
    // and the node's position in the array, are both left alone.
    data.createdAt = day(-99);
    (data.__history as unknown[]).push({ at: day(45), kind: "data", data: { title: "Must survive a reload" } });
    const after = indexOf(edited);

    let stable = true;
    for (const entry of before.entries) {
        if (entry.locator.kind === "phase") continue;
        if (after.byCode.get(entry.code)?.targetId !== entry.targetId) stable = false;
    }
    check("correcting a card's date renumbers nothing", stable);
}

// --- 9. Soft delete holds its slot -------------------------------------------------------------
{
    const before = indexOf(studyFixture());
    const deleted = studyFixture();
    const target = deleted.nodes.find((node) => node.id === "i1")!;
    (target.data as Record<string, unknown>).deletedAt = day(44);
    const after = indexOf(deleted);

    equal("a deleted card keeps its code", nodeToCode(after, "i1"), "I1");
    equal("and reports that it is gone", after.byCode.get("I1")?.status, "deleted");
    equal("with the date it went", after.byCode.get("I1")?.deletedAt, day(44));

    let stable = true;
    for (const entry of before.entries) {
        if (entry.locator.kind === "phase") continue;
        if (after.byCode.get(entry.code)?.targetId !== entry.targetId) stable = false;
    }
    check("nothing after a deletion shifts", stable);

    // A tombstone is nameable but not openable, so the sentence has to say so rather than link.
    const sentence = describeLocatorStatus(after.byCode.get("I1")!);
    check("the deleted sentence names the card and the date",
        sentence.includes("I1") && sentence.includes("2026-02-14"));
}

// --- 10. A relabelled card is renumbered, not silently reused ----------------------------------
// Changing a card's label is the one edit derivation cannot absorb: the card leaves one kind's
// namespace and joins another's, so both series shift. This checks that the *old* code is answered
// rather than lost, and then that persisting codes is what stops the collateral drift.
{
    const relabelled = studyFixture();
    const data = relabelled.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>;
    // The state persistence leaves behind: the code says requirement, the label now says insight.
    data.locatorCode = "R1";
    data.label = "insight";
    const after = indexOf(relabelled);

    equal("the old code is retired, not broken", after.byCode.get("R1")?.status, "retired");
    // `r1` sits earlier in the document than `i1`, so on the insight series it takes I1 and pushes
    // the existing insight to I2. That collateral shift is exactly the hazard persistence answers.
    equal("the card answers to its new code", nodeToCode(after, "r1"), "I1");
    equal("and the retired code names it", after.byCode.get("R1")?.supersededBy, "I1");
    equal("the previously-numbered insight was pushed along", nodeToCode(after, "i1"), "I2");
    check("the retired sentence says it was renumbered",
        describeLocatorStatus(after.byCode.get("R1")!).includes("renumbered"));

    // The same relabel, on a document whose codes had been written down. Now nothing moves but the
    // card that changed, which is the whole reason `planLocatorAssignments` exists.
    const pinned = studyFixture();
    (pinned.nodes.find((node) => node.id === "i1")!.data as Record<string, unknown>).locatorCode = "I1";
    const pinnedData = pinned.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>;
    pinnedData.locatorCode = "R1";
    pinnedData.label = "insight";
    const afterPinned = indexOf(pinned);
    equal("a written-down code is not disturbed by somebody else's relabel",
        nodeToCode(afterPinned, "i1"), "I1");
    equal("and the relabelled card takes the next free ordinal instead",
        nodeToCode(afterPinned, "r1"), "I2");

    // The retired ordinal is never handed to anything else.
    const later = studyFixture();
    const laterData = later.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>;
    laterData.locatorCode = "R1";
    laterData.label = "insight";
    later.nodes.push(card("r5", "requirement", "A new requirement", day(70)));
    const afterLater = indexOf(later);
    check("a retired ordinal is not reused", nodeToCode(afterLater, "r5") !== "R1");
}

// --- 11. A persisted code is honoured, never reassigned ---------------------------------------
{
    const pinned = studyFixture();
    // Somebody exported this project once already and the numbering was written down.
    (pinned.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>).locatorCode = "R4";
    const after = indexOf(pinned);
    equal("a persisted code wins over the derived one", nodeToCode(after, "r1"), "R4");

    const grown = studyFixture();
    (grown.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>).locatorCode = "R4";
    grown.nodes.push(card("r6", "requirement", "Another", day(70)));
    const afterGrown = indexOf(grown);
    equal("a new card avoids the claimed ordinal", nodeToCode(afterGrown, "r6"), "R1");

    // `planLocatorAssignments` proposes only what is missing, and never contradicts a claim.
    const plan = planLocatorAssignments(afterGrown, grown.nodes);
    check("the plan leaves an already-correct code alone",
        !plan.some((entry) => entry.nodeId === "r1"));
    check("the plan covers the unwritten cards",
        plan.some((entry) => entry.nodeId === "r6" && entry.code === "R1"));
    check("the plan proposes nothing for a group box",
        !plan.some((entry) => entry.nodeId === "g1"));
}

// --- 12. The phase contract: the anchor survives, the extent does not --------------------------
{
    const before = indexOf(studyFixture());
    const anchorBefore = before.byCode.get("P1")?.targetId;
    check("P1 has an anchor", typeof anchorBefore === "string" && anchorBefore !== "");

    // Insert an activity in the gap, which is exactly what moves a boundary.
    const moved = studyFixture();
    moved.nodes.push(card("a4", "activity", "Mid-study workshop", day(20)));
    const after = indexOf(moved);

    const phaseAfter = after.byCode.get("P1");
    check("P1 still resolves", phaseAfter !== undefined);
    equal("P1 still names the same anchor activity", phaseAfter?.targetId, anchorBefore);
    // Deliberately NOT asserted: that P1 contains the same activities. The segmentation is recomputed
    // from time gaps against content affinity, so its extent is free to move. That omission IS the
    // contract — see LOCATOR_PHASE_CONTRACT. Asserting membership here would pin behaviour the
    // feature explicitly does not promise, and the next tuning of the cut rule would "break" it.
}

// --- 13. Anchors and URLs agree --------------------------------------------------------------
{
    const index = indexOf(studyFixture());
    let anchorsAgree = true;
    let urlsRoundTrip = true;
    for (const entry of index.entries) {
        if (codeToAnchor(entry.code) !== entry.code.toLowerCase()) anchorsAgree = false;
        const url = codeToUrl(index, entry.code, { projectId: "proj-1", basename: "/vitral" });
        if (url === null) { urlsRoundTrip = false; continue; }
        const parsed = new URL(url, "http://example.test");
        if (parsed.searchParams.get("ref") !== entry.code) urlsRoundTrip = false;
        if (parsed.searchParams.get("n") !== entry.targetId) urlsRoundTrip = false;
        if (parseLocatorCode(parsed.searchParams.get("ref"))?.code !== entry.code) urlsRoundTrip = false;
    }
    check("the markdown anchor is the lowercased code, always", anchorsAgree);
    check("every URL carries the code and the target id, and parses back", urlsRoundTrip);

    equal("a production basename is applied exactly",
        codeToUrl(index, "A1", { projectId: "p", basename: "/vitral" }),
        "/project/p?ref=A1&n=a1".replace("/project", "/vitral/project"));
    equal("a root basename adds no prefix",
        codeToUrl(index, "A1", { projectId: "p", basename: "/" }),
        "/project/p?ref=A1&n=a1");
    equal("a trailing slash on the basename is tolerated",
        codeToUrl(index, "A1", { projectId: "p", basename: "/vitral/" }),
        "/vitral/project/p?ref=A1&n=a1");
    equal("an origin makes it absolute",
        codeToUrl(index, "A1", { projectId: "p", basename: "/vitral", origin: "https://host" }),
        "https://host/vitral/project/p?ref=A1&n=a1");
    check("a pinned link carries the instant",
        (codeToUrl(index, "A1", { projectId: "p", at: day(50) }) ?? "").includes(`at=${encodeURIComponent(day(50))}`));
    equal("an unknown code has no URL", codeToUrl(index, "R99", { projectId: "p" }), null);
    equal("a malformed code has no URL", codeToUrl(index, "nonsense", { projectId: "p" }), null);
}

// --- 14. A `.vi` round trip changes nothing ----------------------------------------------------
// Import and duplication rewrite file ids and nothing else (`remapStateFileReferences` touches
// `attachmentIds`, `origin` and `fileId`). Node ids, edge ids and the whole timeline survive. Keying
// files on `sha256` rather than `file.id` is what makes the F codes survive with them.
{
    const files = [
        { sha256: "hash-a", name: "one.pdf", createdAt: day(5) },
        { sha256: "hash-b", name: "two.pdf", createdAt: day(6) },
    ];
    const original = studyFixture();
    (original.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>).attachmentIds = ["file-id-1"];
    const before = indexOf(original, files);

    const imported: Fixture = JSON.parse(JSON.stringify(original));
    // The remap: a fresh id for the same bytes.
    (imported.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>).attachmentIds = ["file-id-9"];
    const after = indexOf(imported, files);

    let stable = true;
    for (const entry of before.entries) {
        if (after.byCode.get(entry.code)?.targetId !== entry.targetId) stable = false;
    }
    check("every code including the file codes survives an import remap", stable);
    equal("F1 is still the same bytes", after.byCode.get("F1")?.targetId, "hash-a");
}

// --- 15. Determinism -------------------------------------------------------------------------
{
    const a = indexOf(studyFixture(), [{ sha256: "h", name: "f.pdf", createdAt: day(3) }]);
    const b = indexOf(studyFixture(), [{ sha256: "h", name: "f.pdf", createdAt: day(3) }]);
    equal("the same document produces the same index",
        a.entries.map((entry) => `${entry.code}:${entry.targetId}`),
        b.entries.map((entry) => `${entry.code}:${entry.targetId}`));

    // Edge order is not information, so shuffling it must change nothing. Node order deliberately IS
    // information here — it is the document's insertion log — so it is not shuffled.
    const shuffled = studyFixture();
    shuffled.edges.reverse();
    const c = indexOf(shuffled, [{ sha256: "h", name: "f.pdf", createdAt: day(3) }]);
    equal("edge order does not affect the numbering",
        c.entries.filter((entry) => entry.locator.kind !== "phase").map((entry) => `${entry.code}:${entry.targetId}`),
        a.entries.filter((entry) => entry.locator.kind !== "phase").map((entry) => `${entry.code}:${entry.targetId}`));
}

// --- 16. Timeline entities and the report asymmetry --------------------------------------------
{
    const fixture = studyFixture();
    const membership = buildActivityTreeMembership(fixture.nodes, fixture.edges);
    const index = buildLocatorIndex({
        nodes: fixture.nodes,
        edges: fixture.edges,
        files: [],
        timeline: {
            stages: [
                { id: "st-2", name: "Summative", start: day(30), end: day(60) },
                { id: "st-1", name: "Formative", start: day(0), end: day(29) },
            ],
            designStudyEvents: [{ id: "ev-1", name: "Expert review", occurredAt: day(35) }],
        },
        membership,
        clusters: [],
        asOf: { version: 1, capturedAt: day(60) },
    });
    equal("stages are numbered in time order, not array order", index.byCode.get("S1")?.title, "Formative");
    equal("the later stage is S2", index.byCode.get("S2")?.title, "Summative");
    equal("a design study event is an E code", index.byCode.get("E1")?.targetId, "ev-1");

    const setAside = studyFixture();
    (setAside.nodes.find((node) => node.id === "c1")!.data as Record<string, unknown>).relevant = false;
    const asideIndex = indexOf(setAside);
    equal("a card marked not relevant still has a code", nodeToCode(asideIndex, "c1"), "C1");
    equal("but the report body does not anchor it", asideIndex.byCode.get("C1")?.inDocument, false);
    equal("a relevant card is anchored", indexOf(studyFixture()).byCode.get("C1")?.inDocument, true);
}

// --- 17. describeLocatorStatus is total -------------------------------------------------------
{
    const index = indexOf(studyFixture());
    const live = index.byCode.get("A1")!;
    const statuses = ["live", "deleted", "retired", "unknown"] as const;
    let allSpeak = true;
    for (const status of statuses) {
        const sentence = describeLocatorStatus({ ...live, status, supersededBy: null, deletedAt: null });
        if (typeof sentence !== "string" || sentence.trim() === "") allSpeak = false;
    }
    check("every status yields a sentence, so nothing renders blank", allSpeak);
}

// --- 18. Degenerate documents -----------------------------------------------------------------
{
    const empty = buildLocatorIndex({
        nodes: [],
        edges: [],
        files: [],
        timeline: { stages: [], designStudyEvents: [] },
        membership: new Map(),
        clusters: [],
        asOf: { version: 0, capturedAt: day(0) },
    });
    equal("an empty document has no codes", empty.entries.length, 0);
    equal("and nothing resolves", nodeToCode(empty, "anything"), null);

    const single: Fixture = { nodes: [card("only", "activity", "Just one", day(0))], edges: [] };
    const singleIndex = indexOf(single);
    equal("one activity is A1", nodeToCode(singleIndex, "only"), "A1");
    // Below `MIN_ACTIVITIES_TO_CLUSTER` no *boundary* is cut, so the whole study is one phase rather
    // than none — and that phase's anchor is the only activity there is.
    equal("one activity is its own phase", singleIndex.byCode.get("P1")?.targetId, "only");

    const orphan: Fixture = { nodes: [card("lone", "insight", "Unattached", day(0))], edges: [] };
    const orphanIndex = indexOf(orphan);
    equal("a card reaching no activity still gets a code", nodeToCode(orphanIndex, "lone"), "I1");
    equal("and resolves at Detail, because Overview would fold it into a glyph",
        orphanIndex.byCode.get("I1")?.viewpoint.level, 3);
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} locator check(s) failed`);
}
console.log("ALL PASS");
