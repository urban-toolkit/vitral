import type { ReportModel } from "./reportModel";

/**
 * The one place a model is still asked for anything, and the gate on what comes back.
 *
 * The reviewers' objection to AI authorship was well aimed at the old report, where seven sections of
 * free prose were the whole document and five of them received nothing but the *abstract* as context —
 * so they hallucinated by construction. What is left is one paragraph of framing over figures that
 * are already in the document, and it is optional: the deterministic body is complete without it.
 *
 * Two rules make it safe rather than merely small. The payload contains **codes, never ids and never
 * raw graph** — so the model can only refer to things the document itself names. And
 * `acceptAbstract` **rejects the whole paragraph** if it cites a code that does not exist, because a
 * fabricated citation is worse than no abstract: it is exactly the failure a reader cannot check.
 *
 * The paragraph is written from the **requirements and concepts**: what the study set out to satisfy,
 * and the ideas it developed doing so. Those are the two card kinds that describe intent rather than
 * incident, which is what an abstract is for — a summary assembled from activities would read as a
 * diary, and the Timeline section already is one.
 */

export type ReportAbstractPayload = {
    projectTitle: string;
    projectGoal: string;
    span: { startIso: string | null; endIso: string | null };
    counts: {
        phases: number;
        threads: number;
        cards: number;
        authored: number;
        modelProposed: number;
        byLabel: Array<{ label: string; count: number }>;
    };
    phases: Array<{
        code: string | null;
        label: string;
        labelSource: string;
        startIso: string | null;
        endIso: string | null;
        threadCount: number;
        cardCount: number;
        headline: Array<{ code: string | null; label: string; title: string }>;
    }>;
    /** What the study set out to satisfy. The abstract is written from these first. */
    requirements: Array<{ code: string | null; title: string; description: string; answered: boolean }>;
    /** The ideas the study developed while satisfying them. */
    concepts: Array<{ code: string | null; title: string; description: string }>;
    insights: Array<{ code: string | null; title: string; description: string }>;
    participants: Array<{ name: string; role: string }>;
};

/** How much of a description to send. Enough to be summarised, not enough to be reproduced. */
const DESCRIPTION_BUDGET_CHARS = 400;

export function buildAbstractPayload(model: ReportModel): ReportAbstractPayload {
    const contentCards = model.allCards.filter((card) => card.label !== "person");
    const answered = new Set(model.requirementAnswers.map((entry) => entry.requirement.nodeId));

    const byLabel = new Map<string, number>();
    for (const card of contentCards) {
        byLabel.set(card.label, (byLabel.get(card.label) ?? 0) + 1);
    }

    return {
        projectTitle: model.snapshot.projectTitle,
        projectGoal: model.snapshot.projectGoal,
        span: {
            startIso: model.snapshot.timeline.startIso,
            endIso: model.snapshot.timeline.endIso,
        },
        counts: {
            phases: model.phases.length,
            threads: model.phases.reduce((sum, phase) => sum + phase.threads.length, 0)
                + model.looseThreads.length,
            cards: contentCards.length,
            authored: contentCards.filter((card) => card.authorship === "authored").length,
            modelProposed: contentCards.filter((card) => card.authorship === "model-proposed").length,
            byLabel: Array.from(byLabel.entries())
                .map(([label, count]) => ({ label, count }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        },
        phases: model.phases.map((phase) => ({
            code: phase.code,
            label: phase.label,
            labelSource: phase.labelSource,
            startIso: phase.startIso,
            endIso: phase.endIso,
            threadCount: phase.threads.length,
            cardCount: phase.cardCount,
            headline: phase.headline.map((card) => ({
                code: card.code,
                label: card.label,
                title: card.title,
            })),
        })),
        requirements: [...model.requirementAnswers.map((entry) => entry.requirement), ...model.unansweredRequirements]
            .map((card) => ({
                code: card.code,
                title: card.title,
                description: card.description.slice(0, DESCRIPTION_BUDGET_CHARS),
                answered: answered.has(card.nodeId),
            })),
        concepts: model.concepts.map((card) => ({
            code: card.code,
            title: card.title,
            description: card.description.slice(0, DESCRIPTION_BUDGET_CHARS),
        })),
        insights: model.insights.map((card) => ({
            code: card.code,
            title: card.title,
            description: card.description.slice(0, DESCRIPTION_BUDGET_CHARS),
        })),
        participants: model.participants,
    };
}

/** Bracketed code-shaped tokens, so a fabricated one can be caught before it reaches the document. */
const CODE_TOKEN = /\[([A-Za-z]+\d+)\]/g;

const WORD_BUDGET = 400;

/**
 * What a model returned, or `null` if it must not be used.
 *
 * Refusal is the point of this function, so the reasons are worth stating: a heading would break the
 * document's outline, a fence would show as a code block, and a code the payload never contained is a
 * citation the reader would follow to nothing. In every one of those cases returning nothing is
 * better than returning something — the surrounding document is already complete.
 */
export function acceptAbstract(raw: string, allowedCodes: ReadonlySet<string>): string | null {
    if (typeof raw !== "string") return null;

    let text = raw.trim();
    if (text === "") return null;

    // Strip a wrapping code fence, which models add despite being told not to.
    const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text);
    if (fenced) text = fenced[1].trim();
    if (text.includes("```")) return null;

    // Headings and list markers would fight the document's own structure.
    const lines = text.split(/\r?\n/);
    if (lines.some((line) => /^\s{0,3}#{1,6}\s/.test(line))) return null;
    if (lines.some((line) => /^\s{0,3}([-*+]|\d+\.)\s/.test(line))) return null;

    if (text.split(/\s+/).filter(Boolean).length > WORD_BUDGET) return null;

    for (const match of text.matchAll(CODE_TOKEN)) {
        if (!allowedCodes.has(match[1].toUpperCase())) return null;
    }

    return text;
}
