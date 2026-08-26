/**
 * Properties of the connection rule. Run with `npm run test:connection-rule`.
 *
 * What is pinned here is the rule, not any particular graph: only an activity may stand alone, a
 * batch of deletions is judged as a batch, a card that is already loose is never made worse, and
 * the spawn boxes only ever offer a partner the relation table actually allows. The last one is the
 * one most likely to rot — a new entry in `ALLOWED_RELATION_LABEL_BY_PAIR` changes what every box
 * on the canvas offers, and this says so out loud.
 *
 * Kept inside `src` so `tsc` typechecks it against the modules it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import type { edgeType, nodeType } from "@/config/types";
import {
    describeBlockedRemovals,
    planEdgeRemovals,
    requiresConnection,
    withArticle,
} from "@/pages/projectEditor/graphInvariants";
import { KNOWN_CARD_LABELS } from "@/pages/projectEditor/graphSemantics";
import {
    findCardSpawnTarget,
    getCardSpawnTargets,
    CARD_HEIGHT_PX,
    CARD_WIDTH_PX,
} from "@/pages/projectEditor/canvasGeometry";
import { relationLabelFor, relationPartnersFor, spawnPartnerFor } from "@/utils/relationships";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean) {
    checks += 1;
    if (condition) return;
    failures += 1;
    console.log(`FAIL  ${label}`);
}

function equal(label: string, actual: unknown, expected: unknown) {
    check(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
        JSON.stringify(actual) === JSON.stringify(expected));
}

function card(id: string, label: string, extra: Record<string, unknown> = {}): nodeType {
    return {
        id,
        position: { x: 0, y: 0 },
        type: "card",
        data: { label, type: "social", title: id, ...extra } as nodeType["data"],
    };
}

function edge(id: string, source: string, target: string, deletedAt?: string): edgeType {
    return { id, source, target, type: "relation", data: deletedAt ? { deletedAt } : {} };
}

// --- requiresConnection --------------------------------------------------------------------

check("an activity may stand alone", !requiresConnection(card("a", "activity")));
for (const label of KNOWN_CARD_LABELS) {
    if (label === "activity") continue;
    check(`a ${label} must stay connected`, requiresConnection(card("n", label)));
}
check("a blueprint component is outside the rule", !requiresConnection({
    id: "bc",
    position: { x: 0, y: 0 },
    type: "blueprintComponent",
    data: { label: "blueprint_component" } as nodeType["data"],
}));
check("a soft-deleted card is outside the rule",
    !requiresConnection(card("gone", "object", { deletedAt: "2024-01-01T00:00:00.000Z" })));
check("`task` still reads as a requirement", requiresConnection(card("t", "task")));
// The extraction path writes the model's own entity string onto the node and clamps it only on the
// edge, so a card labelled `finding` exists, draws as an `object`, and must inherit the rule.
check("an off-ontology label is read as the object it draws as",
    requiresConnection(card("odd", "finding")));
check("...and so is an empty one", requiresConnection(card("blank", "")));

// --- planEdgeRemovals ----------------------------------------------------------------------

{
    // activity -- object, and nothing else. The object's only edge is not the user's to take.
    const nodes = [card("A", "activity"), card("O", "object")];
    const edges = [edge("e1", "A", "O")];
    const plan = planEdgeRemovals(nodes, edges, ["e1"]);
    equal("last edge of a card is blocked", plan.removable, []);
    equal("...and names the card", plan.blocked.map((b) => b.nodeId), ["O"]);
}

{
    // Two edges into the object: one may go, the second may not.
    const nodes = [card("A", "activity"), card("B", "activity"), card("O", "object")];
    const edges = [edge("e1", "A", "O"), edge("e2", "B", "O")];

    const one = planEdgeRemovals(nodes, edges, ["e1"]);
    equal("a card with two edges can lose one", one.removable, ["e1"]);

    // The batch case: checked independently both would see a degree of two and both would pass.
    const both = planEdgeRemovals(nodes, edges, ["e1", "e2"]);
    equal("a batch cannot take both", both.removable, ["e1"]);
    equal("...and blocks the second", both.blocked.map((b) => b.edgeId), ["e2"]);
}

{
    // Both ends guarded: the edge is the only connection either card has.
    const nodes = [card("O1", "object"), card("O2", "object")];
    const edges = [edge("e1", "O1", "O2")];
    const plan = planEdgeRemovals(nodes, edges, ["e1"]);
    equal("an island of two is not dissolvable", plan.removable, []);
}

{
    // Activities are exempt, so an activity-to-activity edge is always removable.
    const nodes = [card("A", "activity"), card("B", "activity")];
    const edges = [edge("e1", "A", "B")];
    equal("activity-to-activity is free", planEdgeRemovals(nodes, edges, ["e1"]).removable, ["e1"]);
}

{
    // A card that is already loose (imported that way) is never made worse; the unrelated deletion
    // it is not part of still goes through.
    const nodes = [card("A", "activity"), card("O", "object"), card("LOOSE", "insight")];
    const edges = [edge("e1", "A", "O"), edge("e2", "A", "O")];
    const plan = planEdgeRemovals(nodes, edges, ["e1"]);
    equal("a pre-existing orphan blocks nothing", plan.removable, ["e1"]);
    check("...and is not reported", plan.blocked.length === 0);
    check("...but is still a guarded card", requiresConnection(nodes[2]));
}

{
    // Deleting the card itself is a different gesture: its edges leave with it, unjudged.
    const nodes = [card("A", "activity"), card("O", "object")];
    const edges = [edge("e1", "A", "O")];
    const plan = planEdgeRemovals(nodes, edges, ["e1"], { deletingNodeIds: new Set(["O"]) });
    equal("a card's own deletion takes its edges", plan.removable, ["e1"]);
}

{
    // An already soft-deleted edge changes no degree and is handed straight back.
    const nodes = [card("A", "activity"), card("O", "object")];
    const edges = [edge("e1", "A", "O"), edge("e2", "A", "O", "2024-01-01T00:00:00.000Z")];
    const plan = planEdgeRemovals(nodes, edges, ["e2", "e1"]);
    equal("a dead edge does not count as the survivor", plan.removable, ["e2"]);
    equal("...so the live one is still the last", plan.blocked.map((b) => b.edgeId), ["e1"]);
}

{
    // A self-edge connects a card to nothing: it must neither satisfy the rule nor be undeletable.
    const nodes = [card("A", "activity"), card("O", "object")];

    const onlyLoop = [edge("loop", "O", "O")];
    equal("a self-loop is not the connection that keeps a card alive",
        planEdgeRemovals(nodes, onlyLoop, ["loop"]).removable, ["loop"]);

    const loopAndReal = [edge("loop", "O", "O"), edge("e1", "A", "O")];
    const plan = planEdgeRemovals(nodes, loopAndReal, ["e1"]);
    equal("...so it cannot stand in for the real one", plan.removable, []);
    equal("...and the real one is what gets blocked", plan.blocked.map((b) => b.edgeId), ["e1"]);
}

// --- message building ------------------------------------------------------------------------

equal("one blocked card", withArticle("insight"), "an insight");
equal("...and a consonant", withArticle("person"), "a person");

{
    const blockedOf = (...titles: string[]) => titles.map((title, index) => ({
        edgeId: `e${index}`, nodeId: `n${index}`, title, label: "object",
    }));
    check("two cards are joined with `and`",
        describeBlockedRemovals(blockedOf("Alpha", "Beta")).startsWith("“Alpha” and “Beta” would be"));
    check("three or more do not double the `and`",
        describeBlockedRemovals(blockedOf("Alpha", "Beta", "Gamma"))
            .startsWith("“Alpha”, “Beta” and others would be"));
}

// --- spawn partners ------------------------------------------------------------------------

for (const label of KNOWN_CARD_LABELS) {
    if (label === "activity") continue;
    const partner = spawnPartnerFor(label);
    check(`a ${label} card has something to spawn`, partner !== null);
    if (!partner) continue;
    equal(
        `a ${label} box offers a legal pair`,
        relationLabelFor(label, partner.label),
        partner.relationLabel,
    );
    check(
        `a ${label} box's partner is in its partner list`,
        relationPartnersFor(label).some((candidate) => candidate.label === partner.label),
    );
}

equal("a requirement extends sideways", spawnPartnerFor("requirement"),
    { label: "requirement", relationLabel: "details" });
equal("a concept extends sideways", spawnPartnerFor("concept"),
    { label: "concept", relationLabel: "composes" });
equal("an object extends sideways", spawnPartnerFor("object"),
    { label: "object", relationLabel: "relevant to" });
// Neither has a self pair, so each takes the most specific partner it has.
equal("an insight grows a concept", spawnPartnerFor("insight"),
    { label: "concept", relationLabel: "part of" });
equal("a person's only move is an activity", spawnPartnerFor("person"),
    { label: "activity", relationLabel: "part of" });

// --- spawn box geometry --------------------------------------------------------------------

{
    const anchor: nodeType = {
        ...card("O", "object"),
        position: { x: 1000, y: 500 },
    };
    const nodes = [anchor, card("A", "activity")];

    const targets = getCardSpawnTargets(nodes);
    equal("two boxes per non-activity card, none on the activity", targets.length, 2);
    check("one per handle", targets.some((t) => t.direction === "incoming")
        && targets.some((t) => t.direction === "outgoing"));

    const outgoing = targets.find((t) => t.direction === "outgoing")!;
    const incoming = targets.find((t) => t.direction === "incoming")!;
    check("the output box sits past the right border", outgoing.center.x > 1000 + CARD_WIDTH_PX);
    check("the input box sits before the left border", incoming.center.x < 1000);
    equal("both sit on the handle line", [outgoing.center.y, incoming.center.y],
        [500 + (CARD_HEIGHT_PX / 2), 500 + (CARD_HEIGHT_PX / 2)]);
    check("keys distinguish the two boxes", outgoing.key !== incoming.key);

    check("a point inside the box hits it",
        findCardSpawnTarget(targets, outgoing.center)?.key === outgoing.key);
    check("a point on the card itself hits nothing",
        findCardSpawnTarget(targets, { x: 1100, y: 600 }) === null);
    check("a point past the box hits nothing",
        findCardSpawnTarget(targets, { x: outgoing.center.x + outgoing.size, y: outgoing.center.y })
            === null);
}

{
    // A dragged file is always an `object`, and `insight|object` is not a legal pair — so an
    // insight card must not advertise a drop target that would be refused on release.
    const nodes = [card("I", "insight"), card("O", "object"), card("R", "requirement")];
    const forObject = getCardSpawnTargets(nodes, { spawnLabel: "object" });
    equal("boxes narrowed to what an object may attach to",
        [...new Set(forObject.map((t) => t.nodeId))].sort(), ["O", "R"]);
    check("...and each carries that pair's relation",
        forObject.every((t) => t.spawnLabel === "object"
            && t.relationLabel === relationLabelFor(t.anchorLabel, "object")));
}

{
    // Soft-deleted cards leave the graph, so they offer nothing.
    const nodes = [card("O", "object", { deletedAt: "2024-01-01T00:00:00.000Z" })];
    equal("a deleted card has no boxes", getCardSpawnTargets(nodes).length, 0);
}

{
    // Same closing as `requiresConnection`: a card drawn as an `object` gets an `object`'s boxes.
    equal("an off-ontology card still gets boxes", getCardSpawnTargets([card("odd", "finding")]).length, 2);
    equal("...offering what an object offers",
        getCardSpawnTargets([card("odd", "finding")])[0].spawnLabel, "object");
}

{
    // Two cards at the layout's tightest horizontal pitch — the unassigned band's
    // `CARD_WIDTH_PX + UNASSIGNED_ITEM_GAP_PX`. Their facing boxes must not overlap, or the one
    // painted second washes out the highlight on the one the click will actually resolve to.
    const left: nodeType = { ...card("L", "object"), position: { x: 0, y: 0 } };
    const right: nodeType = { ...card("R", "object"), position: { x: CARD_WIDTH_PX + 80, y: 0 } };
    const targets = getCardSpawnTargets([left, right]);
    const leftOut = targets.find((t) => t.nodeId === "L" && t.direction === "outgoing")!;
    const rightIn = targets.find((t) => t.nodeId === "R" && t.direction === "incoming")!;
    const gap = (rightIn.center.x - (rightIn.size / 2)) - (leftOut.center.x + (leftOut.size / 2));
    check(`facing boxes clear each other at the tightest pitch (gap ${gap}px)`, gap > 0);
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} connection-rule check(s) failed`);
}
console.log("ALL PASS");
