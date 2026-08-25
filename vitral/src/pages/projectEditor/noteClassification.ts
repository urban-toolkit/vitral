/**
 * Turning a typed sentence into a card, deterministically.
 *
 * The note tool exists so the researcher's own words reach the graph. Everything else on the
 * canvas is the artifact's voice -- extracted from a dropped file by the model -- and a card the
 * researcher typed is the only place their reading of the study is recorded verbatim.
 *
 * The label is a *guess*, scored from keyword cues, and the guess is deliberately cheap and
 * legible rather than clever:
 *
 *  - **No LLM.** Note capture is a reading-path affordance, and the reading path never calls a
 *    model (AGENTS.md contract 19). A round trip would also put a spinner between the researcher
 *    having a thought and the thought being on the canvas, which is the cost the tool exists to
 *    avoid.
 *  - **The guess is shown before it is committed.** `matchedCues` exists so the widget can say
 *    *why* it guessed, and the label stays overridable in the widget and afterwards through the
 *    select on the card front. A visible guess and a silent one are different features.
 *  - **The raw sentence is never rewritten.** `description` is the input, byte for byte. Only
 *    `title` is derived, and only by clipping.
 */

import type { cardLabel, ProjectParticipant } from "@/config/types";

export type NoteConfidence = "strong" | "weak";

export type NoteClassification = {
    /** The guessed label. `weak` confidence means this is the fallback, not a positive match. */
    label: cardLabel;
    /** First clause of the note, clipped. Never says more than the note said. */
    title: string;
    /** The note, verbatim. */
    description: string;
    confidence: NoteConfidence;
    /** Human-readable cue names, in scoring order, for the widget to show. */
    matchedCues: string[];
};

export const NOTE_CLASSIFICATION_TUNING = {
    /**
     * How far the winning label must lead the runner-up. Its job is to refuse ambiguity rather
     * than to resolve it: "we should check whether the analysis is exploratory" reads equally as
     * a requirement and an insight, and silently committing to one is worse than falling back to
     * a label the researcher can see is a default.
     */
    MARGIN: 1,
    /** Title budget. Past this the title stops describing the note and starts repeating it. */
    TITLE_MAX_CHARS: 60,
    /** Shortest acceptable word-boundary cut, below which we clip mid-word instead. */
    TITLE_MIN_WORD_BREAK: 20,
    /**
     * Where an unscored or ambiguous note lands. `insight` is the honest neutral for a typed
     * thought -- most notes are a reading of something -- and it is the cheapest to correct,
     * because it is promotable and therefore stays visible rather than being buried.
     */
    FALLBACK_LABEL: "insight" as cardLabel,
    /** An exact participant-name hit. Strong enough to outrun any keyword pile-up. */
    PARTICIPANT_WEIGHT: 3,
} as const;

type Cue = {
    label: cardLabel;
    /** Shown to the researcher, so it reads as a reason and not as a regex. */
    name: string;
    weight: number;
    pattern: RegExp;
};

/**
 * Order is significant only for reporting: scoring sums every match, and ties are resolved by the
 * margin gate rather than by position, so the table can be extended anywhere without changing an
 * existing verdict.
 */
const CUES: readonly Cue[] = [
    // activity -- the time-bearing hub. These describe an occasion, not a claim.
    { label: "activity", name: "meeting", weight: 2, pattern: /\bmeetings?\b/i },
    { label: "activity", name: "session", weight: 1, pattern: /\bsessions?\b/i },
    { label: "activity", name: "workshop", weight: 2, pattern: /\bworkshops?\b/i },
    { label: "activity", name: "interview", weight: 2, pattern: /\binterviews?\b/i },
    { label: "activity", name: "call", weight: 1, pattern: /\bcall\b/i },
    { label: "activity", name: "demo", weight: 1, pattern: /\bdemos?\b/i },
    { label: "activity", name: "sync", weight: 1, pattern: /\bsync\b/i },
    { label: "activity", name: "kickoff", weight: 2, pattern: /\bkick-?off\b/i },
    { label: "activity", name: "standup", weight: 2, pattern: /\bstand-?up\b/i },
    { label: "activity", name: "\"met with\"", weight: 2, pattern: /\bmet with\b/i },
    { label: "activity", name: "\"presented to\"", weight: 2, pattern: /\bpresented to\b/i },
    { label: "activity", name: "leading weekday", weight: 2, pattern: /^\s*(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b/i },
    { label: "activity", name: "leading date", weight: 2, pattern: /^\s*\d{1,4}[-/.]\d{1,2}([-/.]\d{1,4})?\b/ },

    // requirement -- "a need, pain, question, or todo to be tackled" (CardsFromTextInput.txt)
    { label: "requirement", name: "\"need\"", weight: 2, pattern: /\bneeds?\b/i },
    { label: "requirement", name: "\"must\"", weight: 2, pattern: /\bmust\b/i },
    { label: "requirement", name: "\"should\"", weight: 1, pattern: /\bshould\b/i },
    { label: "requirement", name: "\"want\"", weight: 1, pattern: /\bwants?\b/i },
    { label: "requirement", name: "\"requires\"", weight: 2, pattern: /\brequires?\b/i },
    { label: "requirement", name: "\"todo\"", weight: 2, pattern: /\bto-?do\b/i },
    { label: "requirement", name: "obligation", weight: 1, pattern: /\b(have|has) to\b/i },
    { label: "requirement", name: "blocker", weight: 2, pattern: /\b(cannot|blocked)\b|\bcan.?t\b/i },
    { label: "requirement", name: "pain", weight: 2, pattern: /\b(problems?|pain|issues?|missing)\b/i },
    { label: "requirement", name: "a question", weight: 2, pattern: /\?\s*$/ },

    // insight -- "a finding derived after thinking, analysis or discussion"
    { label: "insight", name: "\"realized\"", weight: 2, pattern: /\breali[sz](e|ed|ing)\b/i },
    { label: "insight", name: "\"turns out\"", weight: 2, pattern: /\bturns out\b/i },
    { label: "insight", name: "\"learned that\"", weight: 2, pattern: /\blearned that\b/i },
    { label: "insight", name: "\"found that\"", weight: 2, pattern: /\bfound that\b/i },
    { label: "insight", name: "\"suggests\"", weight: 1, pattern: /\bsuggests?\b/i },
    { label: "insight", name: "\"means that\"", weight: 2, pattern: /\bmeans that\b/i },
    { label: "insight", name: "\"therefore\"", weight: 1, pattern: /\btherefore\b/i },
    { label: "insight", name: "\"takeaway\"", weight: 2, pattern: /\btake-?away\b/i },
    { label: "insight", name: "\"surprising\"", weight: 1, pattern: /\bsurprising\b/i },
    { label: "insight", name: "hedged claim", weight: 1, pattern: /\b(apparently|it seems)\b/i },

    // concept -- "a conceptual reference/definition"
    { label: "concept", name: "definition", weight: 2, pattern: /\b(refers to|defined as|known as|the term)\b/i },
    { label: "concept", name: "\"is a\"", weight: 1, pattern: /\bis an?\b/i },
    { label: "concept", name: "\"called\"", weight: 1, pattern: /\bcalled\b/i },
    { label: "concept", name: "citation", weight: 2, pattern: /\bet al\.?|\(\d{4}\)/i },
    { label: "concept", name: "quoted term", weight: 1, pattern: /["“][^"”]{2,40}["”]/ },

    // person -- role words only. A role word can never carry the verdict on its own; see below.
    { label: "person", name: "role", weight: 1, pattern: /\b(PI|specialists?|domain experts?|experts?|participants?|stakeholders?)\b/i },

    // object -- "a software, digital, or data object"
    { label: "object", name: "file extension", weight: 2, pattern: /\.(csv|ipynb|py|json|md|tsx?|jsx?|sql|parquet|xlsx?)\b/i },
    { label: "object", name: "data artefact", weight: 2, pattern: /\b(datasets?|notebooks?|databases?|tables?)\b/i },
    { label: "object", name: "code artefact", weight: 1, pattern: /\b(scripts?|repo(sitor(y|ies))?|API|endpoints?|functions?|class(es)?|pipelines?)\b/i },
];

/** Whole-word, case-insensitive, regex-safe match of a participant's name anywhere in the note. */
function mentionsParticipant(text: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed.length < 2) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(text);
}

/**
 * The first clause, clipped to the title budget. Never paraphrases: everything returned here is a
 * prefix of what the researcher typed, so a title can say less than the note but never more.
 */
export function deriveNoteTitle(text: string): string {
    const collapsed = text.trim().replace(/\s+/g, " ");
    if (!collapsed) return "Untitled";

    const sentenceEnd = collapsed.search(/[.!?](\s|$)/);
    const firstClause = sentenceEnd >= 0 ? collapsed.slice(0, sentenceEnd + 1) : collapsed;

    if (firstClause.length <= NOTE_CLASSIFICATION_TUNING.TITLE_MAX_CHARS) {
        // A trailing period adds nothing to a title; a question mark carries meaning, so it stays.
        return firstClause.replace(/\.$/, "");
    }

    const clipped = firstClause.slice(0, NOTE_CLASSIFICATION_TUNING.TITLE_MAX_CHARS);
    const lastSpace = clipped.lastIndexOf(" ");
    const cut = lastSpace >= NOTE_CLASSIFICATION_TUNING.TITLE_MIN_WORD_BREAK
        ? clipped.slice(0, lastSpace)
        : clipped;
    return `${cut.trimEnd()}…`;
}

export function classifyNote(
    text: string,
    participants: readonly ProjectParticipant[] = [],
): NoteClassification {
    const description = text;
    const title = deriveNoteTitle(text);

    const scores = new Map<cardLabel, number>();
    const cues: string[] = [];
    const add = (label: cardLabel, weight: number, name: string) => {
        scores.set(label, (scores.get(label) ?? 0) + weight);
        cues.push(name);
    };

    // A participant's own name is the one signal here that is not a guess: the researcher already
    // told the project who is in the study, so a hit is a lookup rather than an inference.
    let namedParticipant = false;
    for (const participant of participants) {
        if (!mentionsParticipant(text, participant.name)) continue;
        namedParticipant = true;
        add("person", NOTE_CLASSIFICATION_TUNING.PARTICIPANT_WEIGHT, `names ${participant.name.trim()}`);
    }

    for (const cue of CUES) {
        if (!cue.pattern.test(text)) continue;
        add(cue.label, cue.weight, cue.name);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const winner = ranked[0]?.[0];
    const winningScore = ranked[0]?.[1] ?? 0;
    const runnerUpScore = ranked[1]?.[1] ?? 0;

    const fallback: NoteClassification = {
        label: NOTE_CLASSIFICATION_TUNING.FALLBACK_LABEL,
        title,
        description,
        confidence: "weak",
        matchedCues: cues,
    };

    if (winner === undefined || winningScore <= 0) return fallback;
    if (winningScore - runnerUpScore < NOTE_CLASSIFICATION_TUNING.MARGIN) return fallback;

    // `person` cards are context, not content: they are excluded from glyph labels, from promotion
    // and from auto-linking, so a card wrongly filed as one quietly drops out of the abstraction
    // instead of surfacing somewhere it would get corrected. Role words alone are not enough.
    if (winner === "person" && !namedParticipant) return fallback;

    return { label: winner, title, description, confidence: "strong", matchedCues: cues };
}
