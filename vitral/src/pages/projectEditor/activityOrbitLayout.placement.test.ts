/**
 * Equality check for the rewritten tree placement scan. Run with `npm run test:placement`.
 *
 * `resolveTreeCenterY` was hoisting nothing: it recomputed each placed disc's clearance and the
 * horizontal-gap test inside all 401 iterations of its candidate scan, and used `Math.hypot`. The
 * rewrite pre-filters to the discs that can collide at all, precomputes their vertical slack, and
 * compares squared distances. That is meant to be a pure speed-up, so this pins it against a naive
 * transcription of the original over a few thousand random configurations.
 *
 * Kept inside `src` so `tsc` typechecks it against the module it exercises; it uses no Node-only
 * globals, so it runs standalone under esbuild + node.
 */

import {
    ACTIVITY_TREE_GAP_PX,
    ACTIVITY_TREE_Y_MAX_STEPS,
    ACTIVITY_TREE_Y_STEP_PX,
    resolveTreeCenterY,
    type TreeDisc,
} from "@/pages/projectEditor/activityOrbitLayout";

/** The original implementation, verbatim apart from its name. */
function resolveTreeCenterYNaive(placed: TreeDisc[], x: number, radius: number): number {
    const collidesAt = (y: number) => placed.some((disc) => {
        const minDistance = disc.radius + radius + ACTIVITY_TREE_GAP_PX;
        if (Math.abs(disc.x - x) >= minDistance) return false;
        return Math.hypot(disc.x - x, disc.y - y) < minDistance;
    });

    for (let step = 0; step <= ACTIVITY_TREE_Y_MAX_STEPS; step += 1) {
        const magnitude = Math.ceil(step / 2) * ACTIVITY_TREE_Y_STEP_PX;
        const candidate = step % 2 === 1 ? magnitude : -magnitude;
        if (!collidesAt(candidate)) return candidate;
    }

    const lowest = placed.reduce((max, disc) => Math.max(max, disc.y + disc.radius), 0);
    return lowest + radius + ACTIVITY_TREE_GAP_PX;
}

/** Seeded xorshift32, so a failure is reproducible rather than a one-off. */
function makeRandom(seed: number) {
    let state = seed | 0 || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>> 0) % 1_000_000) / 1_000_000;
    };
}

let failures = 0;
let compared = 0;
const random = makeRandom(0x5eed1234);

// A spread of shapes: empty, single, crowded, wide-apart, and everything overlapping at one x.
for (let trial = 0; trial < 3000; trial += 1) {
    const count = Math.floor(random() * 12);
    const spread = trial % 3 === 0 ? 40 : trial % 3 === 1 ? 900 : 4000;
    const placed: TreeDisc[] = [];
    for (let index = 0; index < count; index += 1) {
        placed.push({
            x: Math.round((random() - 0.5) * spread),
            y: Math.round((random() - 0.5) * spread),
            radius: 60 + Math.round(random() * 400),
        });
    }
    const x = Math.round((random() - 0.5) * spread);
    const radius = 60 + Math.round(random() * 400);

    const expected = resolveTreeCenterYNaive(placed, x, radius);
    const actual = resolveTreeCenterY(placed, x, radius);
    compared += 1;

    // `===` rather than `Object.is`: with nothing in the way the original returned `-0` and the
    // rewrite returns `0`, which are the same coordinate.
    if (expected !== actual) {
        failures += 1;
        if (failures <= 5) {
            console.log(
                `FAIL  trial ${trial}: expected ${expected}, got ${actual}\n`
                + `      x=${x} radius=${radius} placed=${JSON.stringify(placed)}`,
            );
        }
    }
}

console.log(`ok    ${compared - failures}/${compared} placements agree with the naive scan`);

if (failures > 0) {
    // A throw is the exit code: this runs under plain node, with no test runner to report to.
    throw new Error(`${failures} placement mismatch(es)`);
}
console.log("ALL PASS");
