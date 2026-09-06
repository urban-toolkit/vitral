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
    DIGIT_TWIN,
    LOCATOR_KIND_LETTER,
    LOCATOR_KIND_LEVEL,
    LOCATOR_LENS_SUFFIX,
    LOCATOR_LETTER_KIND,
    buildLocatorIndex,
    codeToAnchor,
    codeToUrl,
    describeLocatorStatus,
    formatLocatorCode,
    isLocatableId,
    nodeToCode,
    parseLocatorCode,
    parseLocatorReference,
    planLocatorAssignments,
    resolveLocatorReference,
    type LocatorIndex,
    type LocatorKind,
} from "@/pages/projectEditor/locators";
import { buildActivityClusters } from "@/pages/projectEditor/canvasClusters";
import { buildActivityTreeMembership } from "@/pages/projectEditor/activityOrbitLayout";
import { buildSalienceIndex } from "@/pages/projectEditor/canvasSalience";
import {
    SYNTHETIC_ID_PREFIX,
    buildAbstractedGraph,
    type CanvasFocusPath,
    type CanvasLevel,
} from "@/pages/projectEditor/canvasAbstraction";

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

// --- 2b. The lens suffix ------------------------------------------------------------------------
{
    equal("a bare code is the Detail lens", parseLocatorReference("R1")?.lens, "detail");
    equal("and canonicalises to itself", parseLocatorReference("R1")?.reference, "R1");
    equal("D is the same lens said out loud", parseLocatorReference("R1D")?.lens, "detail");
    equal("and canonicalises back to the bare code", parseLocatorReference("R1D")?.reference, "R1");
    equal("P is the phase", parseLocatorReference("R1P")?.lens, "overview");
    equal("A is the root activity", parseLocatorReference("R1A")?.lens, "activity");
    equal("T is the thread", parseLocatorReference("R1T")?.lens, "thread");
    equal("F is the attached file", parseLocatorReference("R1F")?.lens, "file");
    equal("AF is the activity's attached file", parseLocatorReference("R1AF")?.lens, "activityFile");
    equal("a suffix is case-folded like the letter", parseLocatorReference("r1af")?.reference, "R1AF");

    // `R10` and `R1O` are one glyph apart on a printed page, and `O` used to be a valid suffix, so
    // one of them could be retyped into the other. `P` retired that, but `DIGIT_TWIN` still runs on
    // the first character only and the two still have to parse as different things.
    equal("R10 is the tenth requirement", parseLocatorReference("R10")?.locator.ordinal, 10);
    equal("and carries no lens", parseLocatorReference("R10")?.lens, "detail");

    // The invariant that replaced that hazard rather than merely warning about it: nothing in the
    // suffix alphabet is a character `DIGIT_TWIN` repairs, so no valid reference can be turned into
    // a *different valid reference* by a retyping slip. A new lens letter has to keep this true.
    const twins = new Set(Object.values(DIGIT_TWIN));
    const collidingSuffix = Object.values(LOCATOR_LENS_SUFFIX)
        .filter((suffix) => suffix !== "")
        .filter((suffix) => Array.from(suffix).some((letter) => twins.has(letter)));
    equal("no lens suffix is a digit twin", collidingSuffix, []);

    // An unrecognised suffix is refused rather than ignored: dropping it would answer a question
    // nobody asked, and the reader would never learn the suffix was wrong.
    equal("an unknown suffix is refused", parseLocatorReference("R1X"), null);
    equal("a two-letter unknown suffix is refused", parseLocatorReference("R1TO"), null);
    equal("and the retired Overview suffix is refused like any other",
        parseLocatorReference("R1O"), null);

    // `parseLocatorCode` answers for the artifact, so every caller that indexes by code still works.
    equal("a lensed reference still names its artifact", parseLocatorCode("R1AF")?.code, "R1");
}

// --- 2c. A retired suffix is refused, but by name -----------------------------------------------
// `R1O` is not a typo. It is the spelling every document exported before `P` took the phase lens
// still prints, so the refusal has to be actionable rather than merely correct.
{
    const index = indexOf(studyFixture());

    const retired = resolveLocatorReference(index, "R1O");
    check("R1O is refused", !retired.ok);
    if (!retired.ok) {
        check("naming the replacement letter", retired.reason.includes("P"));
        check("and spelling out what to type", retired.reason.includes("R1P"));
    }

    // Only where the rest of the code is well formed: an unrecognised letter is not owed a
    // confident answer about a suffix that was never its problem.
    const nonsense = resolveLocatorReference(index, "Z1O");
    check("an unknown kind letter is refused", !nonsense.ok);
    if (!nonsense.ok) check("without the retired-suffix hint", !nonsense.reason.includes("Z1P"));
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
        // The one place a lens-invented id is *correct*: a phase is not a stored node, so the thing
        // to centre for it is the glyph the lens draws. `targetId` above still has to be the real
        // anchor activity, which is what keeps the citation renumber-proof.
        if (String(entry.viewpoint.nodeId ?? "").startsWith("vz:c:") === false
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

    // A phase code is a citation *of the phase*, so it lands on the phase's summary glyph rather
    // than opening the phase up. The focus stays uncut in both components — not a detail: a focused
    // cluster raises its activities to level 2, and `buildAbstractedGraph` only keeps a phase glyph
    // while every activity in it is still abstract, so cutting the focus would delete the very node
    // `nodeId` names.
    const phase = index.byCode.get("P1");
    equal("a phase opens itself and nothing deeper", phase?.viewpoint.focus.activityId, null);
    equal("a phase opens no cluster either", phase?.viewpoint.focus.clusterId, null);
    check("a phase centres its own summary glyph",
        String(phase?.viewpoint.nodeId ?? "").startsWith("vz:c:"));
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

// --- 12. A reference resolves to a viewpoint, and the lens picks how deep the focus is cut ------
{
    const index = indexOf(studyFixture());

    const detail = resolveLocatorReference(index, "R1");
    check("a bare reference resolves", detail.ok);
    if (detail.ok) {
        equal("Detail centres the card itself", detail.viewpoint.nodeId, "r1");
        equal("and cuts the focus all the way to its thread", detail.viewpoint.focus.activityId, "a1");
        equal("and asks for no file", detail.openAttachmentOf, null);
    }

    const thread = resolveLocatorReference(index, "R1T");
    check("the thread lens resolves", thread.ok);
    if (thread.ok) {
        equal("Threads centres the activity", thread.viewpoint.nodeId, "a1");
        // One cut shallower: the phase is open, so its activities are glyphs, but no activity is.
        equal("and stops at the phase", thread.viewpoint.focus.activityId, null);
        check("keeping the phase itself open", thread.viewpoint.focus.clusterId !== null);
    }

    const overview = resolveLocatorReference(index, "R1P");
    check("the overview lens resolves", overview.ok);
    if (overview.ok) {
        equal("Overview cuts the focus away entirely", overview.viewpoint.focus.activityId, null);
        equal("and again", overview.viewpoint.focus.clusterId, null);
        check("centring the phase glyph itself",
            String(overview.viewpoint.nodeId ?? "").startsWith("vz:c:"));
    }

    const activity = resolveLocatorReference(index, "R1A");
    check("the activity lens resolves", activity.ok);
    if (activity.ok) {
        equal("it centres the root activity", activity.viewpoint.nodeId, "a1");
        equal("at Detail, so the activity is a card rather than a glyph",
            activity.viewpoint.focus.activityId, "a1");
    }

    const file = resolveLocatorReference(index, "R1F");
    check("the file lens resolves", file.ok);
    if (file.ok) {
        equal("it names the card whose attachment to open", file.openAttachmentOf, "r1");
        equal("and puts the canvas where the Detail lens would", file.viewpoint.nodeId, "r1");
    }

    const activityFile = resolveLocatorReference(index, "R1AF");
    check("the activity-file lens resolves", activityFile.ok);
    if (activityFile.ok) {
        equal("it names the activity's attachment", activityFile.openAttachmentOf, "a1");
        equal("and travels to the activity", activityFile.viewpoint.nodeId, "a1");
    }

    // An activity is its own thread, so every lens still answers for one.
    const ownThread = resolveLocatorReference(index, "A2T");
    check("an activity has a thread lens", ownThread.ok);
    if (ownThread.ok) equal("which is itself", ownThread.viewpoint.nodeId, "a2");

    /*
     * A phase code, and the lenses on one.
     *
     * The bare code is the interesting case and the one that used to be broken: `P1` centres the
     * phase's own glyph with the focus uncut, so a reader following a citation to a phase arrives
     * looking *at* the phase. Opening it into its threads is still reachable — it is what `P1T`
     * means — but it is no longer what citing a phase does.
     *
     * The rest are here because a phase's focus carries neither cluster nor activity any more, so
     * every lens that needs one now reaches for a fallback, and a fallback that quietly stops working
     * would show up as a refusal a reader cannot act on.
     */
    const bare = resolveLocatorReference(index, "P1");
    check("a phase reference resolves", bare.ok);
    if (bare.ok) {
        check("centring the phase's own glyph",
            String(bare.viewpoint.nodeId ?? "").startsWith("vz:c:"));
        equal("with nothing opened", bare.viewpoint.focus.clusterId, null);
        equal("and nothing opened deeper", bare.viewpoint.focus.activityId, null);
        equal("at Overview", bare.viewpoint.level, 1);
        equal("asking for no file", bare.openAttachmentOf, null);
    }

    // `P1P` is "the phase P1 belongs to", which is P1 — an alias, not a second destination. It has to
    // agree with the bare code exactly, or `locatorTex` would emit two spellings for one place.
    const phaseOfPhase = resolveLocatorReference(index, "P1P");
    check("the overview lens still answers for a phase", phaseOfPhase.ok);
    if (phaseOfPhase.ok && bare.ok) {
        equal("landing where the bare code does", phaseOfPhase.viewpoint.nodeId, bare.viewpoint.nodeId);
    }

    // What `P1` used to do, now spelled as what it is.
    const phaseThreads = resolveLocatorReference(index, "P1T");
    check("the thread lens opens the phase", phaseThreads.ok);
    if (phaseThreads.ok && bare.ok) {
        equal("cutting the focus to the cluster", phaseThreads.viewpoint.focus.clusterId,
            bare.viewpoint.nodeId);
        equal("but no deeper", phaseThreads.viewpoint.focus.activityId, null);
        equal("and centring the anchor activity", phaseThreads.viewpoint.nodeId,
            index.byCode.get("P1")?.targetId);
    }

    // The activity lens still reaches the anchor, and still carries the phase around it.
    const phaseActivity = resolveLocatorReference(index, "P1A");
    check("the activity lens answers for a phase", phaseActivity.ok);
    if (phaseActivity.ok && bare.ok) {
        equal("naming the phase it sits in", phaseActivity.viewpoint.focus.clusterId,
            bare.viewpoint.nodeId);
        equal("and opening the anchor activity", phaseActivity.viewpoint.focus.activityId,
            index.byCode.get("P1")?.targetId);
    }

    // A glyph is not a stored node, so it holds no attachment. The refusal has to be about the phase
    // not being a card — not about a card that happens to have no file.
    const phaseFile = resolveLocatorReference(index, "P1F");
    check("a phase has no file of its own", !phaseFile.ok);
    if (!phaseFile.ok) check("and says it is not a card", phaseFile.reason.includes("not a card"));

    // A blueprint component belongs to no thread by design (`LOCATOR_KIND_LEVEL`), so the lenses that
    // need one refuse rather than inventing an owner.
    const componentThread = resolveLocatorReference(index, "B1T");
    check("a component has no thread to show", !componentThread.ok);
    if (!componentThread.ok) {
        check("and says so in words", componentThread.reason.includes("thread"));
        equal("echoing what was typed", componentThread.reference, "B1T");
    }

    // A file code has no node, so the Detail lens still answers but the file lens has nothing of its
    // own to open — a file is not a card holding an attachment, it *is* the attachment.
    const withFile = indexOf(studyFixture(), [
        { sha256: "aaa", name: "transcript.pdf", createdAt: day(5) },
    ]);
    check("a file code resolves as itself", resolveLocatorReference(withFile, "F1").ok);
    const fileOfFile = resolveLocatorReference(withFile, "F1F");
    check("but has no attachment of its own", !fileOfFile.ok);
    if (!fileOfFile.ok) check("and says why", fileOfFile.reason.includes("not a card"));

    const nonsense = resolveLocatorReference(index, "R1X");
    check("an unparseable reference is refused", !nonsense.ok);
    const missing = resolveLocatorReference(index, "R99");
    check("a reference to nothing is refused", !missing.ok);
    if (!missing.ok) check("naming the code", missing.reason.includes("R99"));
}

// --- 13. A deleted target refuses every lens ----------------------------------------------------
{
    const deleted = studyFixture();
    (deleted.nodes.find((node) => node.id === "r1")!.data as Record<string, unknown>).deletedAt = day(9);
    const index = indexOf(deleted);

    for (const reference of ["R1", "R1P", "R1A", "R1T", "R1F", "R1AF"]) {
        const outcome = resolveLocatorReference(index, reference);
        check(`${reference} refuses a deleted target`, !outcome.ok);
    }
}

// --- 14. A URL carries the lens, and the artifact's own node ------------------------------------
// `codeToUrl` used to parse with `parseLocatorCode` and write the bare code back, so every lensed
// link an exported document printed asked for the card instead of the view.
{
    const index = indexOf(studyFixture());
    const options = { projectId: "proj-1", basename: "/vitral" };
    const r1 = index.byCode.get("R1")!;

    const bare = new URL(codeToUrl(index, "R1", options)!, "http://example.test");
    equal("a bare code round-trips", bare.searchParams.get("ref"), "R1");
    equal("carrying its node", bare.searchParams.get("n"), r1.targetId);

    const lensed = new URL(codeToUrl(index, "R1P", options)!, "http://example.test");
    equal("a lensed reference keeps its suffix", lensed.searchParams.get("ref"), "R1P");
    // The *artifact's* node, not the phase glyph's: a lens is a view of R1, so R1 is the claim
    // worth checking on arrival, and a `vz:c:` id must never reach a URL in any case.
    equal("and still names the artifact's node", lensed.searchParams.get("n"), r1.targetId);
    check("never a synthetic id", !String(lensed.searchParams.get("n")).startsWith("vz:"));

    equal("a retired suffix builds no URL at all", codeToUrl(index, "R1O", options), null);
}

// --- 15. The node in a link outranks the code in it ---------------------------------------------
// A citation carries both halves because ordinals can be renumbered by a hard delete or a relabel.
// When they disagree the id wins: a paper that cites R7 means the card its author was looking at.
{
    const index = indexOf(studyFixture());
    const r1 = index.byCode.get("R1")!;
    const concept = index.byCode.get("C1")!;

    const agreeing = resolveLocatorReference(index, "R1", r1.targetId);
    check("an id that agrees changes nothing", agreeing.ok);
    if (agreeing.ok) {
        equal("resolving to the code's own target", agreeing.target.code, "R1");
        equal("and reporting no renumbering", agreeing.renumberedFrom, null);
    }

    // `C1` standing in for "the node R1 used to be": the code says R1, the id says something the
    // index now calls C1, and the reader asked for the thing the document was about.
    const drifted = resolveLocatorReference(index, "R1", concept.targetId);
    check("a disagreeing id is followed", drifted.ok);
    if (drifted.ok) {
        equal("landing on the node the link named", drifted.target.targetId, concept.targetId);
        equal("under the code it answers to now", drifted.target.code, "C1");
        equal("and saying which code the link used", drifted.renumberedFrom, "R1");
        equal("while still quoting what was asked for", drifted.reference, "R1");
    }

    // The lens survives the redirect: `R1P` asks for a phase whichever card it lands on.
    const driftedLens = resolveLocatorReference(index, "R1P", concept.targetId);
    check("a lensed reference redirects too", driftedLens.ok);
    if (driftedLens.ok) {
        equal("keeping the lens", driftedLens.lens, "overview");
        equal("and reporting the renumbering", driftedLens.renumberedFrom, "R1");
    }

    // An id the index does not hold is a claim about a node that is gone. There is nothing to
    // redirect to, so the code is the only surviving half and it is used unchanged.
    const orphaned = resolveLocatorReference(index, "R1", "no-such-node");
    check("an unknown id falls back to the code", orphaned.ok);
    if (orphaned.ok) {
        equal("resolving normally", orphaned.target.code, "R1");
        equal("and claiming no renumbering", orphaned.renumberedFrom, null);
    }

    // The box supplies nothing, and must behave exactly as it did.
    const typed = resolveLocatorReference(index, "R1");
    check("a typed reference is unaffected", typed.ok);
    if (typed.ok) equal("with no renumbering to report", typed.renumberedFrom, null);
}

// --- 16. A phase's borrowed node is not a renumbering -------------------------------------------
//
// The mirror of 15, and the reason that one is not the whole rule.
//
// A phase has no node of its own, so its `targetId` is *borrowed* from its anchor activity — and
// that activity answers to its own `A` code. `byTargetId` is filled in letter order, so the
// activity, indexed after the phase, wins the shared id. A phase link therefore carries an id that
// resolves to a different code by construction, every single time, with nothing having been
// renumbered. Read as a renumbering it opens the thread at Detail instead of the phase at
// Overview, under a notice naming a rename that never happened.
//
// Every `P` link the report has ever printed carries this shape, which is why the fix belongs in
// the resolver rather than in `codeToUrl`.
{
    const index = indexOf(studyFixture());
    const phase = index.byCode.get("P1")!;

    // The premise, stated so a future reader does not have to rediscover it: the id really is shared.
    const owner = index.byTargetId.get(phase.targetId)!;
    check("a phase's node is owned by an activity in byTargetId", owner.locator.kind === "activity");

    const followed = resolveLocatorReference(index, "P1", phase.targetId);
    check("a phase link resolves", followed.ok);
    if (followed.ok) {
        equal("to the phase, not to its anchor activity", followed.target.code, "P1");
        equal("at Overview", followed.viewpoint.level, 1);
        equal("claiming no renumbering", followed.renumberedFrom, null);
    }

    // A lens on a phase code is subject to the same rule.
    const lensed = resolveLocatorReference(index, "P1A", phase.targetId);
    check("and so does a lensed phase reference", lensed.ok);
    if (lensed.ok) equal("with no renumbering either", lensed.renumberedFrom, null);

    // Section 15 must not be weakened by the fix: a *card* code with a disagreeing id still redirects.
    const concept = index.byCode.get("C1")!;
    const drifted = resolveLocatorReference(index, "R1", concept.targetId);
    check("a card reference still follows its id", drifted.ok);
    if (drifted.ok) equal("and still reports the renumbering", drifted.renumberedFrom, "R1");
}

// --- 17. A viewpoint names a node the canvas actually draws ------------------------------------
//
// The one property the rest of this file cannot see. Every check above reads the index and stops
// there, so a viewpoint can be internally consistent, resolve cleanly, and still name nothing: the
// reveal hands `nodeId` to `requestNodeFocus`, which searches the *drawn* nodes, waits out its
// deadline, and reports the target as unshowable. Two modules have to agree and neither test
// crossed the seam.
//
// It is a real failure and not a hypothetical one. A phase glyph exists only while every activity in
// its cluster is still abstract — focusing the cluster is exactly what raises them — so the obvious
// spelling of "go to phase P1", focus the cluster *and* centre its glyph, deletes the node it aims
// at. That is why a phase's viewpoint leaves the focus uncut.
{
    const fixture = studyFixture();
    const live = fixture.nodes.filter((node) => {
        const deletedAt = (node.data as Record<string, unknown>).deletedAt;
        return typeof deletedAt !== "string" || deletedAt.trim() === "";
    });
    const membership = buildActivityTreeMembership(live, fixture.edges);
    const salience = buildSalienceIndex(live, fixture.edges, membership);
    const clusters = buildActivityClusters({
        activities: live.filter((node) => (node.data as Record<string, unknown>).label === "activity"),
        edges: fixture.edges,
        membership,
        score: salience.score,
    });
    const index = indexOf(fixture);

    const drawnAt = (level: CanvasLevel, focus: CanvasFocusPath) => new Set(
        buildAbstractedGraph({
            nodes: live,
            edges: fixture.edges,
            level,
            focus,
            membership,
            clusters,
            score: salience.score,
        }).nodes.map((node) => node.id),
    );

    // Every navigating reference the file emits, checked against the canvas it would produce.
    let allDrawn = true;
    const missing: string[] = [];
    for (const entry of index.entries) {
        for (const suffix of ["", "P", "A", "T"]) {
            const resolution = resolveLocatorReference(index, `${entry.code}${suffix}`);
            if (!resolution.ok || resolution.viewpoint.nodeId === null) continue;
            if (drawnAt(resolution.viewpoint.level, resolution.viewpoint.focus)
                .has(resolution.viewpoint.nodeId)) continue;
            allDrawn = false;
            missing.push(`${entry.code}${suffix}`);
        }
    }
    check(`every viewpoint centres a node the canvas draws${missing.length > 0 ? ` (missing: ${missing.join(", ")})` : ""}`,
        allDrawn);

    // Stated on its own, because it is the specific thing that was broken and the specific reason
    // the focus has to stay uncut.
    const phase = index.byCode.get("P1")!;
    const glyphId = phase.viewpoint.nodeId!;
    check("a phase's glyph is drawn where its viewpoint puts the canvas",
        drawnAt(phase.viewpoint.level, phase.viewpoint.focus).has(glyphId));
    check("and is gone the moment that phase is opened",
        !drawnAt(1, { clusterId: glyphId, activityId: null }).has(glyphId));
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} locator check(s) failed`);
}
console.log("ALL PASS");
