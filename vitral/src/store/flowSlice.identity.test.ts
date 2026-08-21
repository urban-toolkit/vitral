/**
 * Identity regression check for `flowSlice.ts`. Run with `npm run test:flow-identity`.
 *
 * React Flow keeps a node's cached internals only while the node object it was built from is
 * identical, and `RelationEdge` is memoised on its props. So an edge or node that comes out of a
 * reducer as a fresh object — even with identical contents — re-renders that element and everything
 * derived from it. Before this was guarded, selecting a single edge gave all of them a new identity
 * and invalidated the entire canvas derivation chain: salience, clustering, abstraction, layout.
 *
 * Kept inside `src` so `tsc` typechecks it against the slice it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import flowReducer, { onEdgesChange, onNodesChange } from "@/store/flowSlice";
import type { edgeType, nodeType } from "@/config/types";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
    if (pass) {
        console.log(`ok    ${name}`);
        return;
    }
    failures += 1;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}

function card(id: string, x: number): nodeType {
    return {
        id,
        type: "card",
        position: { x, y: 0 },
        data: { label: "concept", type: "technical", title: id, createdAt: "2026-01-01T00:00:00.000Z" },
    } as nodeType;
}

function relation(id: string, source: string, target: string): edgeType {
    return {
        id,
        source,
        target,
        type: "relation",
        data: { label: "related to", createdAt: "2026-01-01T00:00:00.000Z" },
    } as edgeType;
}

const seed = {
    nodes: [card("n1", 0), card("n2", 400), card("n3", 800)],
    edges: [relation("e1", "n1", "n2"), relation("e2", "n2", "n3")],
    title: "identity fixture",
};

// Normalise once: the first pass through the reducer is allowed to rewrite everything, because it is
// where missing timestamps and history are filled in. Identity is only promised from then on.
const settled = flowReducer(seed, onEdgesChange([{ id: "e1", type: "select", selected: false }]));
const settledAgain = flowReducer(settled, onNodesChange([{ id: "n1", type: "select", selected: false }]));

// --- Selecting one edge must not touch the others.
const afterEdgeSelect = flowReducer(
    settledAgain,
    onEdgesChange([{ id: "e1", type: "select", selected: true }]),
);
check(
    "selecting an edge leaves the other edge object identical",
    afterEdgeSelect.edges[1] === settledAgain.edges[1],
    "e2 was replaced by a fresh object",
);
check(
    "selecting an edge does change the selected edge",
    afterEdgeSelect.edges[0] !== settledAgain.edges[0],
    "e1 was not updated at all",
);
check(
    "selecting an edge leaves every node identical",
    afterEdgeSelect.nodes.every((node, index) => node === settledAgain.nodes[index]),
    "an edge change rewrote node objects",
);

// --- A no-op edge change must not churn either.
const afterNoopEdge = flowReducer(
    afterEdgeSelect,
    onEdgesChange([{ id: "e1", type: "select", selected: true }]),
);
check(
    "a repeated edge selection leaves both edges identical",
    afterNoopEdge.edges[0] === afterEdgeSelect.edges[0]
        && afterNoopEdge.edges[1] === afterEdgeSelect.edges[1],
    "re-applying the same selection replaced edge objects",
);

// --- Moving one node must not rewrite the rest. This is the path that appends position history.
const afterMove = flowReducer(settledAgain, onNodesChange([
    { id: "n2", type: "position", position: { x: 420, y: 30 }, dragging: false },
]));
check(
    "moving a node leaves the other node objects identical",
    afterMove.nodes[0] === settledAgain.nodes[0] && afterMove.nodes[2] === settledAgain.nodes[2],
    "a position change rewrote untouched nodes",
);
check(
    "moving a node does move it",
    afterMove.nodes[1].position.x === 420 && afterMove.nodes[1].position.y === 30,
    `position was ${JSON.stringify(afterMove.nodes[1].position)}`,
);
check(
    "moving a node leaves every edge identical",
    afterMove.edges.every((edge, index) => edge === settledAgain.edges[index]),
    "a node change rewrote edge objects",
);

if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} flow identity check(s) failing`);
}
console.log("ALL PASS");
