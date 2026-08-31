import { SALIENCE_WEIGHTS } from "@/pages/projectEditor/canvasSalience";
import type { ReportCard, ReportRelation } from "./reportModel";

/**
 * The tallies behind the report's Provenance section.
 *
 * This is the part of the document the criticism was actually about: an exported report that says
 * nothing about how the study was made cannot "do justice to the provenance of the whole project",
 * however well written its prose is. Everything here is counted from the graph the researcher built,
 * with no model involved and no network call — so it cannot be wrong in an interesting way and cannot
 * fail to appear.
 *
 * Two of these numbers exist nowhere in the app today and are the cheapest large wins: what was
 * **removed** from the study, and what was **set aside** as not relevant. Both are judgements the
 * researcher made that the canvas otherwise forgets the moment they are made.
 */

export type AuthorshipTally = {
    cards: {
        total: number;
        authored: number;
        modelProposed: number;
        byLabel: Array<{ label: string; authored: number; modelProposed: number }>;
    };
    relations: {
        total: number;
        handDrawn: number;
        modelDerived: number;
        /** Edges predating the `manual` flag. Counted, never guessed at. */
        unknown: number;
    };
};

export function buildAuthorshipTally(
    cards: ReportCard[],
    relations: ReportRelation[],
): AuthorshipTally {
    const byLabel = new Map<string, { authored: number; modelProposed: number }>();
    let authored = 0;
    let modelProposed = 0;

    for (const card of cards) {
        if (card.label === "person") continue;
        const bucket = byLabel.get(card.label) ?? { authored: 0, modelProposed: 0 };
        if (card.authorship === "authored") {
            authored += 1;
            bucket.authored += 1;
        } else {
            modelProposed += 1;
            bucket.modelProposed += 1;
        }
        byLabel.set(card.label, bucket);
    }

    let handDrawn = 0;
    let modelDerived = 0;
    let unknown = 0;
    for (const relation of relations) {
        if (relation.origin === "hand-drawn") handDrawn += 1;
        else if (relation.origin === "model-derived") modelDerived += 1;
        else unknown += 1;
    }

    return {
        cards: {
            total: authored + modelProposed,
            authored,
            modelProposed,
            byLabel: Array.from(byLabel.entries())
                .map(([label, counts]) => ({ label, ...counts }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        },
        relations: { total: relations.length, handDrawn, modelDerived, unknown },
    };
}

export type RelationKindTally = {
    kind: string;
    count: number;
    handDrawn: number;
    modelDerived: number;
    unknown: number;
    /** Similarity evidence, on the automatic edges that carry it. */
    similarity: { min: number; median: number; max: number } | null;
};

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildRelationKindTallies(relations: ReportRelation[]): RelationKindTally[] {
    const byKind = new Map<string, ReportRelation[]>();
    for (const relation of relations) {
        const list = byKind.get(relation.kind) ?? [];
        list.push(relation);
        byKind.set(relation.kind, list);
    }
    return Array.from(byKind.entries())
        .map(([kind, list]) => {
            const scores = list
                .map((relation) => relation.similarity)
                .filter((value): value is number => value !== null);
            return {
                kind,
                count: list.length,
                handDrawn: list.filter((relation) => relation.origin === "hand-drawn").length,
                modelDerived: list.filter((relation) => relation.origin === "model-derived").length,
                unknown: list.filter((relation) => relation.origin === "unknown").length,
                similarity: scores.length > 0
                    ? { min: Math.min(...scores), median: median(scores), max: Math.max(...scores) }
                    : null,
            };
        })
        .sort((a, b) => a.kind.localeCompare(b.kind));
}

export type RevisionSummary = {
    cardsEditedAfterCreation: number;
    cardsNeverEdited: number;
    totalDataRevisions: number;
    /** The most-worked cards, which is where the thinking went. */
    mostRevised: Array<{ code: string | null; title: string; revisions: number }>;
};

export function buildRevisionSummary(cards: ReportCard[]): RevisionSummary {
    const content = cards.filter((card) => card.label !== "person");
    const edited = content.filter((card) => card.dataRevisions > 0);
    return {
        cardsEditedAfterCreation: edited.length,
        cardsNeverEdited: content.length - edited.length,
        totalDataRevisions: content.reduce((sum, card) => sum + card.dataRevisions, 0),
        mostRevised: edited
            .slice()
            .sort((a, b) => (
                b.dataRevisions !== a.dataRevisions
                    ? b.dataRevisions - a.dataRevisions
                    : (a.code ?? "").localeCompare(b.code ?? "")
            ))
            .slice(0, 10)
            .map((card) => ({ code: card.code, title: card.title, revisions: card.dataRevisions })),
    };
}

/**
 * The salience weights, as a table the reader can check the ordering against.
 *
 * Printed rather than described: every card list in this document is ordered by one scalar, and a
 * reader who disagrees with the ordering deserves to see the formula rather than be told it is
 * principled. `authored` being in here is also the whole of the answer to "are the researcher's own
 * cards prioritised" — they are, by 0.20, at equal centrality.
 */
export function salienceWeightRows(): Array<{ term: string; weight: number; means: string }> {
    return [
        { term: "degree", weight: SALIENCE_WEIGHTS.degree, means: "how connected the card is, relative to the most connected" },
        { term: "crossTree", weight: SALIENCE_WEIGHTS.crossTree, means: "reaches beyond its own thread" },
        { term: "iteration", weight: SALIENCE_WEIGHTS.iteration, means: "sits on an `iteration of` relation" },
        { term: "authored", weight: SALIENCE_WEIGHTS.authored, means: "a person put it there rather than a model proposing it" },
        { term: "reference", weight: SALIENCE_WEIGHTS.reference, means: "quotes a passage from a source" },
        { term: "origin", weight: SALIENCE_WEIGHTS.origin, means: "was extracted from a real file" },
        { term: "attachment", weight: SALIENCE_WEIGHTS.attachment, means: "carries a file" },
        { term: "notRelevant", weight: SALIENCE_WEIGHTS.notRelevant, means: "the researcher marked it not relevant" },
    ];
}
