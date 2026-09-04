import type { ReportModel } from "./reportModel";

/**
 * The two places a model is still asked for anything, and the gate on what comes back.
 *
 * The reviewers' objection to AI authorship was well aimed at the old report, where seven sections of
 * free prose were the whole document and five of them received nothing but the *abstract* as context —
 * so they hallucinated by construction. What is left is framing over figures that are already in the
 * document, and all of it is optional: the deterministic body is complete without any of it.
 *
 * Two rules make that safe rather than merely small. The payloads contain **codes, never ids and
 * never raw graph** — so a model can only refer to things the document itself names. And the
 * acceptors **refuse** rather than repair, because a fabricated citation is exactly the failure a
 * reader cannot check.
 *
 * The **abstract** is written from the requirements and concepts: what the study set out to satisfy,
 * and the ideas it developed doing so. Those are the two card kinds that describe intent rather than
 * incident, which is what an abstract is for — a summary assembled from activities would read as a
 * diary, and the Timeline section already is one.
 *
 * The **card-type notes** are one paragraph per kind of card, printed together at the top, so a
 * reader learns what sort of material this study holds before meeting any of it. They are several
 * independent claims rather than one, which is the whole reason their refusal is per kind.
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
    // `card.relevant`, for the same reason `projectReport.stats` and the front-matter Contents row
    // both filter on it: a set-aside card is not part of the study, and a paragraph written from a
    // total the document never prints is a figure a reader cannot check against anything.
    const contentCards = model.allCards.filter((card) => (
        card.label !== "person" && card.relevant
    ));
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

/**
 * Bracketed code-shaped tokens, so a fabricated one can be caught before it reaches the document.
 *
 * Exported because the markdown renderer needs the same regex for a second reason: model prose is
 * pushed into the document verbatim rather than through `ref()`, so the codes inside it have to be
 * registered as cited or they get neither a link definition nor the rewrite that makes an
 * unresolvable code inert — and a literal `[I2]` in the file is the one failure mode the whole
 * shortcut-reference scheme exists to prevent.
 */
export const CODE_TOKEN = /\[([A-Za-z]+\d+)\]/g;

/**
 * A date the exporter's locale would have written, which no part of this document may contain.
 *
 * `reportFormat` bans `toLocaleDateString` outright so that two exports of the same study can be
 * diffed, and the test asserts the shape is absent from the whole file. A model echoing a date out of
 * a researcher's description is the one way it can come back, so the acceptor checks — prose must not
 * be the hole in a rule the rest of the generator keeps.
 */
const LOCALE_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;

const ABSTRACT_WORD_BUDGET = 400;

/**
 * A card-type note is an introduction, not a section. Short enough that six of them together still
 * read as front matter rather than as a second document.
 */
const CARD_TYPE_WORD_BUDGET = 140;

/**
 * One paragraph of machine-written prose, or `null` if it must not be used.
 *
 * Refusal is the point of this function, so the reasons are worth stating: a heading would break the
 * document's outline, a fence would show as a code block, a locale-formatted date would break the one
 * rule that makes this document diffable, and a code the payload never contained is a citation the
 * reader would follow to nothing. In every one of those cases returning nothing is better than
 * returning something — the surrounding document is already complete.
 *
 * Shared rather than copied, because both callers must refuse the same things. What differs between
 * them is the budget and *what happens next*: the abstract is one claim, so a fabricated citation
 * poisons the whole paragraph; the card-type notes are several, so one bad note costs one note.
 */
export function acceptModelProse(
    raw: unknown,
    allowedCodes: ReadonlySet<string>,
    wordBudget: number,
): string | null {
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

    if (LOCALE_DATE.test(text)) return null;

    if (text.split(/\s+/).filter(Boolean).length > wordBudget) return null;

    for (const match of text.matchAll(CODE_TOKEN)) {
        if (!allowedCodes.has(match[1].toUpperCase())) return null;
    }

    return text;
}

/** What a model returned for the abstract, or `null` if it must not be used. */
export function acceptAbstract(raw: string, allowedCodes: ReadonlySet<string>): string | null {
    return acceptModelProse(raw, allowedCodes, ABSTRACT_WORD_BUDGET);
}

/**
 * The card kinds the document introduces at the top, in the order it prints them.
 *
 * `person` is deliberately absent. People are context rather than content everywhere else in this
 * application — never counted, never promoted, never given a row of their own — and a paragraph
 * *about the participants* would be the single place the document characterised them. It would also
 * be the single place real names left the project for a model, which is a decision nobody asked for.
 *
 * Ordered as a study is made rather than as the ontology happens to be listed: what was done, what it
 * had to satisfy, what was found, what was thought, what was gathered, what was built.
 */
export const REPORT_CARD_TYPES = [
    "activity",
    "requirement",
    "insight",
    "concept",
    "object",
    "blueprint_component",
] as const;

export type ReportCardType = (typeof REPORT_CARD_TYPES)[number];

/** What each kind is called in the document. A stored label is not a word for a reader. */
export const REPORT_CARD_TYPE_HEADING: Readonly<Record<ReportCardType, string>> = {
    activity: "Activities",
    requirement: "Requirements",
    insight: "Insights",
    concept: "Concepts",
    object: "Objects",
    blueprint_component: "System components",
};

export type ReportCardTypeEntry = {
    type: ReportCardType;
    heading: string;
    cards: Array<{ code: string | null; title: string; description: string }>;
};

export type ReportCardTypePayload = {
    projectTitle: string;
    projectGoal: string;
    types: ReportCardTypeEntry[];
};

/** One accepted paragraph per kind the model answered for. A kind it refused is simply absent. */
export type ReportCardTypeNotes = {
    notes: Partial<Record<ReportCardType, string>>;
    model: string;
    prompt: string;
};

/**
 * What the model is shown when asked to introduce each kind of card.
 *
 * Codes and text, never ids and never raw graph — the same rule as the abstract, for the same reason.
 *
 * **Emphasised cards only.** These paragraphs sit at the top of a document whose body prints the
 * emphasised cards in full and merely names the rest, so a note written from a card the reader will
 * only ever meet as one line in `Also indexed` would be describing a page that is not there. It also
 * bounds the payload by the same constant that bounds the file.
 *
 * No counts are sent and none are printed. `report.stats` and the front-matter total exclude person
 * cards while Appendix A includes them, so a census here would contradict the row above it.
 */
export function buildCardTypePayload(model: ReportModel): ReportCardTypePayload {
    const byType = new Map<string, ReportCardTypeEntry["cards"]>();
    for (const card of model.allCards) {
        if (!card.relevant || !card.emphasised) continue;
        const list = byType.get(card.label) ?? [];
        list.push({
            code: card.code,
            title: card.title,
            description: card.description.slice(0, DESCRIPTION_BUDGET_CHARS),
        });
        byType.set(card.label, list);
    }

    return {
        projectTitle: model.snapshot.projectTitle,
        projectGoal: model.snapshot.projectGoal,
        types: REPORT_CARD_TYPES
            .filter((type) => (byType.get(type)?.length ?? 0) > 0)
            .map((type) => ({
                type,
                heading: REPORT_CARD_TYPE_HEADING[type],
                cards: byType.get(type)!,
            })),
    };
}

/**
 * The codes each kind's note may cite: its own, and only its own.
 *
 * Narrower than the abstract's allowance on purpose. A paragraph introducing the requirements that
 * reached for an insight's code would be answering the question the note beside it answers, and this
 * gate is what makes the instruction in the prompt true rather than merely requested.
 */
export function allowedCodesByCardType(
    payload: ReportCardTypePayload,
): Map<ReportCardType, Set<string>> {
    const byType = new Map<ReportCardType, Set<string>>();
    for (const entry of payload.types) {
        const codes = new Set<string>();
        for (const card of entry.cards) {
            if (card.code !== null) codes.add(card.code.toUpperCase());
        }
        byType.set(entry.type, codes);
    }
    return byType;
}

/**
 * What the model returned for the card-type notes, kind by kind.
 *
 * The envelope is `{"notes": {"insight": "...", ...}}`, unwrapped from a code fence first — which
 * `acceptAbstract` learned to do the hard way. A model that wraps its JSON would otherwise cost every
 * paragraph at once, which is precisely the all-or-nothing failure this shape exists to avoid.
 *
 * **Refusal is per kind.** Six paragraphs are six independent claims, unlike the abstract's one, so a
 * fabricated citation in the note about objects has no bearing on the note about insights. A kind the
 * model did not answer for is *not* a refusal and is not reported as one: a project with no object
 * cards would otherwise report a failure on a perfect export.
 *
 * Returns `null` only when the envelope itself is unusable, which is the one case the caller has to
 * tell the reader about.
 */
export function acceptCardTypeNotes(
    raw: unknown,
    allowedByType: ReadonlyMap<ReportCardType, ReadonlySet<string>>,
): { notes: Partial<Record<ReportCardType, string>>; refused: ReportCardType[] } | null {
    if (typeof raw !== "string") return null;

    let text = raw.trim();
    const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text);
    if (fenced) text = fenced[1].trim();
    if (text === "") return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    const envelope = (parsed as { notes?: unknown }).notes;
    if (!envelope || typeof envelope !== "object") return null;
    const answers = envelope as Record<string, unknown>;

    const notes: Partial<Record<ReportCardType, string>> = {};
    const refused: ReportCardType[] = [];
    // Iterated in the *document's* order rather than the model's key order, so the refusal list is as
    // deterministic as everything else here.
    for (const type of REPORT_CARD_TYPES) {
        const allowed = allowedByType.get(type);
        if (allowed === undefined) continue;
        const answer = answers[type];
        // Nothing offered, or an empty string — the prompt's way of saying "no". Not a failure.
        if (answer === undefined || answer === null) continue;
        if (typeof answer === "string" && answer.trim() === "") continue;

        const prose = acceptModelProse(answer, allowed, CARD_TYPE_WORD_BUDGET);
        if (prose === null) refused.push(type);
        else notes[type] = prose;
    }

    return { notes, refused };
}
