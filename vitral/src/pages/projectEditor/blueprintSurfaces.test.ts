/**
 * Properties of the tray/canvas split. Run with `npm run test:blueprint-surfaces`.
 *
 * What is pinned here is the rule, not any particular graph: the canvas shows a blueprint component
 * exactly when it answers a requirement that is itself on screen, group boxes never reach it, an
 * attached component arrives with no parent to be placed against, and the wiring between components
 * stays in the tray. The reference-identity checks matter as much as the rest — this filter sits in
 * the middle of the derivation chain, and an array allocated when nothing was removed re-runs
 * salience, clustering, the abstraction lens and the layout for no reason.
 *
 * Kept inside `src` so `tsc` typechecks it against the modules it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import type { edgeType, nodeType } from "@/config/types";
import {
    attachedComponentIds,
    canvasBlueprintEdges,
    canvasBlueprintNodes,
    isBlueprintComponent,
    isBlueprintGroup,
} from "@/pages/projectEditor/blueprintSurfaces";
import {
    buildActivityOrbitLayout,
    buildActivityTreeMembership,
} from "@/pages/projectEditor/activityOrbitLayout";
import { relationLabelFor } from "@/utils/relationships";

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

function component(id: string, extra: Partial<nodeType> = {}): nodeType {
    return {
        id,
        position: { x: 10, y: 20 },
        type: "blueprintComponent",
        data: { label: "blueprint_component", type: "technical", title: id } as nodeType["data"],
        ...extra,
    };
}

function group(id: string, level: string, extra: Partial<nodeType> = {}): nodeType {
    return {
        id,
        position: { x: 0, y: 0 },
        type: "blueprintGroup",
        data: {
            label: "blueprint_group",
            type: "technical",
            title: id,
            blueprintGroupLevel: level,
        } as nodeType["data"],
        ...extra,
    };
}

function edge(id: string, source: string, target: string, label: string, deletedAt?: string): edgeType {
    return {
        id,
        source,
        target,
        type: "relation",
        label,
        data: deletedAt ? { label, deletedAt } : { label },
    };
}

const ids = (nodes: nodeType[]) => nodes.map((node) => node.id);

// --- the relation table still says what this module assumes ----------------------------------

equal(
    "a component answers a requirement with `tackled in`",
    relationLabelFor("blueprint_component", "requirement"),
    "tackled in",
);
equal(
    "two components are wired with `feeds into`",
    relationLabelFor("blueprint_component", "blueprint_component"),
    "feeds into",
);

// --- attachment -------------------------------------------------------------------------------

{
    const nodes = [card("r1", "requirement"), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    equal("a component wired to a requirement is attached",
        Array.from(attachedComponentIds(nodes, edges)), ["c1"]);
}

{
    // `relationPairKey` sorts, so nothing decides which end of the edge the component sits on.
    const nodes = [card("r1", "requirement"), component("c1")];
    const edges = [edge("e1", "r1", "c1", "tackled in")];
    equal("the edge is read in both directions",
        Array.from(attachedComponentIds(nodes, edges)), ["c1"]);
}

{
    const nodes = [card("r1", "requirement"), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in", "2026-01-01T00:00:00.000Z")];
    equal("a soft-deleted edge does not attach (contract 4: reconnect must bring it back)",
        Array.from(attachedComponentIds(nodes, edges)), []);
}

{
    // The playback scoping mechanism, stated as a property: the requirement is gone from the node
    // set the needle produced, so its component is not attached as far as the canvas is concerned.
    const nodes = [component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    equal("a component whose requirement is absent is not attached",
        Array.from(attachedComponentIds(nodes, edges)), []);
}

{
    const nodes = [card("r1", "requirement", { deletedAt: "2026-01-01T00:00:00.000Z" }), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    equal("a soft-deleted requirement does not attach",
        Array.from(attachedComponentIds(nodes, edges)), []);
}

{
    const nodes = [card("r1", "requirement"), card("r2", "requirement"), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in"), edge("e2", "c1", "r2", "tackled in")];
    equal("a component answering two requirements is listed once",
        Array.from(attachedComponentIds(nodes, edges)), ["c1"]);
}

{
    const nodes = [card("i1", "insight"), component("c1")];
    const edges = [edge("e1", "c1", "i1", "tackled in")];
    equal("only a requirement attaches a component",
        Array.from(attachedComponentIds(nodes, edges)), []);
}

{
    const nodes = [component("c1"), component("c2")];
    const edges = [edge("e1", "c1", "c2", "feeds into")];
    equal("`feeds into` never attaches anything",
        Array.from(attachedComponentIds(nodes, edges)), []);
}

// --- the canvas node set ----------------------------------------------------------------------

{
    const paper = group("g0", "paper");
    const high = group("g1", "high", { parentId: "g0", extent: "parent" });
    const nodes = [
        card("a1", "activity"),
        card("r1", "requirement"),
        paper,
        high,
        component("c1", { parentId: "g1", extent: "parent", zIndex: 3 }),
        component("c2", { parentId: "g1", extent: "parent", zIndex: 3 }),
    ];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    const canvas = canvasBlueprintNodes(nodes, edges);

    equal("the canvas keeps cards and attached components only", ids(canvas), ["a1", "r1", "c1"]);
    check("group boxes never reach the canvas", !canvas.some(isBlueprintGroup));
    check("the unattached component stays in the tray", !canvas.some((node) => node.id === "c2"));

    const kept = canvas.find((node) => node.id === "c1")!;
    check("an attached component arrives with no parent", kept.parentId === undefined);
    check("an attached component arrives with no extent", kept.extent === undefined);
    // The layout only strips a stale zIndex from `type === "card"` nodes, so if it survived here it
    // would reach React Flow's wrapper and paint the component over every card around it.
    check("an attached component arrives with no stale zIndex", kept.zIndex === undefined);
    check("the detached clone is stable across calls, so React Flow keeps its cached internals",
        canvasBlueprintNodes(nodes, edges).find((node) => node.id === "c1") === kept);
    check("the original node object is not mutated",
        nodes[4].parentId === "g1" && nodes[4].position.x === 10);
    check("the component is still a component", isBlueprintComponent(kept));
}

{
    const nodes = [card("a1", "activity"), card("r1", "requirement")];
    const edges: edgeType[] = [];
    check("a document with no blueprint node is handed straight back",
        canvasBlueprintNodes(nodes, edges) === nodes);
}

{
    // The case a length comparison cannot see: every component is attached and every group box has
    // been dissolved away, so nothing is *removed* — but the components still carry the `zIndex`
    // of the box they used to sit in, and that has to be stripped or it paints over the cards.
    const nodes = [
        card("r1", "requirement"),
        component("c1", { zIndex: 3 }),
    ];
    const edges = [edge("e1", "r1", "c1", "tackled in")];
    const canvas = canvasBlueprintNodes(nodes, edges);
    check("a same-length pass still detaches, rather than handing the input back",
        canvas !== nodes && canvas.length === 2);
    check("and the stale zIndex is gone",
        canvas.find((node) => node.id === "c1")!.zIndex === undefined);
}

{
    // Already parentless — an isolated component dragged in from a component search, or one made by
    // hand. Nothing to strip, so nothing should be allocated.
    const nodes = [card("r1", "requirement"), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    const canvas = canvasBlueprintNodes(nodes, edges);
    check("nothing was removed, so the array itself comes back", canvas === nodes);
}

// --- the canvas edge set ----------------------------------------------------------------------

{
    const nodes = [card("r1", "requirement"), card("r2", "requirement"), component("c1"), component("c2")];
    const edges = [
        edge("e1", "c1", "r1", "tackled in"),
        edge("e2", "c2", "r2", "tackled in"),
        edge("e3", "c1", "c2", "feeds into"),
        edge("e4", "r1", "r2", "details"),
    ];
    const canvas = canvasBlueprintEdges(nodes, edges);
    equal("`feeds into` is dropped even when both components are attached",
        canvas.map((item) => item.id), ["e1", "e2", "e4"]);
}

{
    const nodes = [card("r1", "requirement"), card("r2", "requirement")];
    const edges = [edge("e4", "r1", "r2", "details")];
    check("a document with no component hands its edges straight back",
        canvasBlueprintEdges(nodes, edges) === edges);
}

{
    const nodes = [card("r1", "requirement"), component("c1")];
    const edges = [edge("e1", "c1", "r1", "tackled in")];
    check("nothing to drop, so the edge array comes back by reference",
        canvasBlueprintEdges(nodes, edges) === edges);
}

// --- what the split buys: the component orbits instead of banding ------------------------------

{
    // The whole point of the rework, stated as a property. An attached component reaches the
    // activity through the requirement it answers, so it is two hops out and orbits there; a group
    // box reaches nothing and is still exiled to the band below. If this ever inverts, blueprint
    // structure has become dislocated from the time axis again.
    const activity = card("a1", "activity", { createdAt: "2026-01-02T00:00:00.000Z" });
    const requirement = card("r1", "requirement");
    const attached = component("c1");
    const box = group("g0", "paper");

    const nodes = [activity, requirement, attached, box];
    const edges = [
        edge("e1", "a1", "r1", "derived from"),
        edge("e2", "c1", "r1", "tackled in"),
    ];

    const membership = buildActivityTreeMembership(nodes, edges);
    // Placed by the layout, but deliberately absent from the membership map. Membership is what the
    // playhead gates whole trees by and what `crossTreeDegree` reads, and a component answering two
    // requirements in two trees can only be given one of them. Whether the canvas draws it is
    // `canvasBlueprintNodes`' answer instead, asked after the playback filter.
    check("a component is not a member of any activity tree",
        membership.get("c1") === undefined);
    check("a group box belongs to no tree either, so the needle never gates it",
        membership.get("g0") === undefined);

    const placed = buildActivityOrbitLayout(nodes, edges);
    const at = (id: string) => placed.find((node) => node.id === id)!.position;
    const orbitDistance = Math.hypot(at("c1").x - at("a1").x, at("c1").y - at("a1").y);

    check(`the component sits on an orbit around the activity (${Math.round(orbitDistance)}px)`,
        orbitDistance > 0 && orbitDistance < 2000);
    check("the component is above the band the group box is exiled to",
        at("c1").y < at("g0").y);
}

{
    // `feeds into` must not shorten a card's path to an activity. Two requirements in two different
    // activity trees, wired together through a chain of tray components: without the guard the BFS
    // walks that chain and r2 changes tree — a requirement moving on the canvas because of
    // something drawn in the tray.
    const nodes = [
        card("a1", "activity", { createdAt: "2026-01-01T00:00:00.000Z" }),
        card("a2", "activity", { createdAt: "2026-06-01T00:00:00.000Z" }),
        card("r1", "requirement"),
        card("r2", "requirement"),
        component("c1"),
        component("c2"),
    ];
    const edges = [
        edge("e1", "a1", "r1", "derived from"),
        edge("e2", "a2", "r2", "derived from"),
        edge("e3", "r1", "c1", "tackled in"),
        edge("e4", "r2", "c2", "tackled in"),
        edge("e5", "c1", "c2", "feeds into"),
    ];

    const membership = buildActivityTreeMembership(nodes, edges);
    equal("a requirement keeps its own activity tree", membership.get("r1"), "a1");
    equal("wiring two components together does not move the other requirement",
        membership.get("r2"), "a2");
}

console.log(`ok    ${checks - failures}/${checks} checks pass`);
if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} blueprint-surface check(s) failed`);
}
console.log("ALL PASS");
