import {
    LOCATOR_LENS_HELP,
    LOCATOR_LENS_SUFFIX,
    LOCATOR_NEXT_STEP_LENSES,
    resolveLocatorReference,
} from "@/pages/projectEditor/locators";
import type { ReportCard, ReportModel, ReportRelation, ReportThread } from "./reportModel";
import {
    CODE_TOKEN,
    REPORT_CARD_TYPES,
    REPORT_CARD_TYPE_HEADING,
} from "./reportAbstract";
import { buildAuthorshipTally } from "./reportProvenance";
import {
    daysBetween,
    formatDayRange,
    formatIsoDay,
    formatIsoMinute,
    headingSlug,
    plural,
    quoteBlock,
    table,
    tableCell,
} from "./reportFormat";
import type { ReportOptions } from "./reportTypes";

/**
 * The model, as markdown. The only file here that knows what a heading looks like.
 *
 * ## Heading depth is canvas level
 *
 * `### P1` is an Overview claim, `#### A3` is a Threads claim, and the tables under a thread are
 * Detail. That is not decoration: it is the same Focus+Context ladder the canvas has, expressed in the
 * one dimension a document owns. A reader who knows the canvas already knows how to read this.
 *
 * ## Anchors, without raw HTML
 *
 * `react-markdown` renders no raw HTML unless `rehype-raw` is installed, and it is not — so an
 * explicit `<a id>` is unavailable and the heading slug is the only anchor there is. Two things make
 * that reliable. Every appendix entry's heading is **the code alone** (`### R7`), so its slug is `r7`:
 * short, ASCII, and identical under GitHub, VS Code, pandoc and `remark-slug`. And every internal
 * link is a **link reference definition** emitted at the foot of the file by the same pass that wrote
 * the heading, so the two are generated from one string and cannot disagree. If a definition were
 * ever missing the body would show a literal `[R7]`, which the test forbids — the failure is loud.
 *
 * ## Two registers, and what is still never done here
 *
 * Nothing is truncated and nothing is dropped. What the document now has is two registers: a card is
 * either **printed** — its table row, its description, its own appendix entry with its source
 * quotation and its canvas links — or **named**, as one line under `Also indexed`. `card.emphasised`
 * decides which, `reportEmphasis.ts` argues the curve, and every section that trims says how many it
 * left to the appendix rather than quietly shortening itself. A reader is never left to wonder
 * whether the document holds a card; only whether this file quotes it.
 *
 * Text is still never cut mid-way, no table cell is ever shortened, and no section summarises what it
 * declines to print. The report the reviewers saw was superficial because it summarised.
 */

const MACHINE_TEXT_BEGIN = "vitral:abstract:begin";
const MACHINE_TEXT_END = "vitral:abstract:end";
const CARD_TYPE_TEXT_BEGIN = "vitral:cardtypes:begin";
const CARD_TYPE_TEXT_END = "vitral:cardtypes:end";

type Emitter = {
    lines: string[];
    /** Slug counters, so two identically-titled sections still get distinct anchors. */
    taken: Map<string, number>;
    /** `code -> slug`, collected as headings are written and emitted as definitions at the end. */
    definitions: Map<string, { slug: string; title: string }>;
    /**
     * Every code the body cited.
     *
     * Collected rather than resolved on the spot, because a code is almost always cited *before* the
     * heading it points at is written — a requirement is named in its thread long before its appendix
     * entry exists. So `ref` writes the shortcut form unconditionally and the final pass decides: a
     * code with a heading becomes a link, and one without becomes plain code text. That is the house
     * rule for an unresolvable reference — nameable, visibly inert, never dressed as a link.
     */
    cited: Set<string>;
};

function push(out: Emitter, ...lines: string[]): void {
    out.lines.push(...lines);
}

function blank(out: Emitter): void {
    if (out.lines.length > 0 && out.lines[out.lines.length - 1] !== "") out.lines.push("");
}

/**
 * A heading, plus the anchor bookkeeping for any code it carries.
 *
 * The slug is computed from the text being emitted, in the same call — that identity is the whole
 * anchor guarantee.
 */
function heading(out: Emitter, depth: number, text: string, code: string | null, describedAs?: string): void {
    blank(out);
    const slug = headingSlug(code !== null ? code : text, out.taken);
    push(out, `${"#".repeat(depth)} ${text}`);
    if (code !== null) {
        out.definitions.set(code, { slug, title: describedAs ?? text });
    }
    blank(out);
}

/** A code, as a shortcut reference. Whether it ends up a link is decided in the final pass. */
function ref(out: Emitter, code: string | null): string {
    if (code === null) return "—";
    out.cited.add(code);
    return `[${code}]`;
}

/**
 * Machine-written prose, pushed verbatim — and its codes registered as if it had used `ref()`.
 *
 * Verbatim because the acceptor has already vouched for the whole string and re-writing a model's
 * sentence would make it no longer the thing that was validated. But the two passes at the foot of
 * this file both key off `out.cited`: one emits a link definition for every cited code, the other
 * rewrites a cited code with no heading into inert `` `R7` ``. Prose that skips `ref()` is therefore
 * in neither set, and a `[I2]` inside it survives to the file as a literal broken link — the exact
 * shape the shortcut-reference scheme exists to prevent, and the only way one can still get out.
 *
 * So the codes are scanned back out and registered. The acceptor has already refused any code the
 * payload did not contain, so this can only ever register a code the project really has; what it
 * decides is whether that code gets a link or gets marked inert, which is the same question every
 * other citation in the document is asked.
 */
function machineProse(out: Emitter, text: string): void {
    push(out, text);
    for (const match of text.matchAll(CODE_TOKEN)) out.cited.add(match[1]);
}

/**
 * How to read a code, in the document that uses them.
 *
 * A reader with the paper in front of them and the canvas open on another screen needs to know two
 * things that are not guessable: that the letter is an altitude rather than a category, and that a
 * suffix can ask for a different one. Both are one sentence each, and the alternative — leaving them
 * undocumented — makes every code in the document look like an arbitrary label.
 *
 * The suffix list is generated from `LOCATOR_LENS_HELP`, the same table the canvas's reference box
 * puts in its tooltip, so the document and the box cannot come to describe different grammars.
 */
/**
 * The whole reference grammar, for the reader.
 *
 * A section of its own rather than a preamble to the index, because it now describes two conventions
 * — the codes in this document, and the same codes typed into the application — and because the
 * next-step links it explains are the thing directly below it.
 *
 * The list of lenses is generated from `LOCATOR_LENS_HELP`, which is also what the canvas box puts in
 * its tooltip, so the document and the box cannot come to describe different grammars. Only the prose
 * around it is written here.
 */
function referenceMechanismLines(): string[] {
    const lines = [
        "Every artifact this study can name carries a short code — `A3`, `R7`, `P1`. The letter says"
        + " what kind of thing it is **and the altitude it is cited at**: `P` is a phase, so it is an"
        + " Overview claim; `A` is an activity, so it is a Threads claim; `R`, `I`, `C` and `O` are"
        + " cards, so they are Detail claims.",
        "",
        "A code that this document prints in full links to its entry in the index below and, where a"
        + " canvas link is available, to the same artifact on the canvas at that altitude. A code the"
        + " document only **names** — one listed under **Also indexed** rather than given an entry of"
        + " its own — is shown as plain `R7` wherever it is cited, because there is nothing here to"
        + " link it to. It is still a real artifact and the same code still resolves on the canvas;"
        + " what it does not have is a page in this file.",
        "",
        "A code can carry a **suffix**, which asks for a different view of the same artifact. One"
        + " artifact therefore has one number and six ways of being looked at, rather than six"
        + " numbers:",
        "",
    ];
    for (const entry of LOCATOR_LENS_HELP) {
        lines.push(`- \`R1${entry.suffix}\` — ${entry.means}`);
    }
    lines.push("");
    lines.push(
        "That is the whole grammar, and it is closed. The views are a ladder — a phase holds threads,"
        + " a thread holds an activity and its cards, a card may carry a file — so a suffix is a step"
        + " up that ladder, then optionally `F` to open what is attached where you landed. Anything"
        + " beyond these six would only repeat one of them: `R1AT` asks for the thread of R1's"
        + " activity, which is R1's thread, which is `R1T`.",
    );
    lines.push("");
    lines.push(
        "**In this document**, each full entry in the index below is followed by the further views"
        + " available for it, written `R1 (P / A / T / F)`. A letter appears only where there is"
        + " something to show: a card with no attached file has no `F`, and a card that belongs to no"
        + " thread has no `P`, `A` or `T`. The **Also indexed** lines carry no further views, but the"
        + " same suffixes work if the code is typed into the application.",
    );
    lines.push("");
    lines.push(
        "**In the application**, the same references go into the canvas's **Go to reference** box,"
        + " which takes the canvas to what the reference names, at the altitude it asks for. Following"
        + " one of the links below does the same thing without the typing.",
    );
    return lines;
}

/**
 * The further views of one card, as links: `R1 (P / A / T / F)`.
 *
 * Which letters appear is decided by **asking the resolver**, not by re-deriving membership here — so
 * the document can only advertise a view the canvas will actually accept, and the refusals stay in
 * one place. `overview` declines a card that belongs to no phase, `thread` and `activity` a card that
 * reaches no activity, and an unconnected card therefore prints no parenthesis at all.
 *
 * The file lens is the one the resolver cannot answer, because `locators.ts` never reads node data.
 * The test applied here is the one `handleGoToLocatorCode` applies before it moves the camera: an
 * attachment id that still resolves to a stored file.
 */
function nextStepLinks(
    card: ReportCard,
    options: ReportOptions,
    hasAttachment: boolean,
): string[] {
    if (card.code === null || options.canvasUrlForCode === null) return [];

    const links: string[] = [];
    for (const lens of LOCATOR_NEXT_STEP_LENSES) {
        if (lens === "file" && !hasAttachment) continue;
        const suffix = LOCATOR_LENS_SUFFIX[lens];
        const reference = `${card.code}${suffix}`;
        if (!resolveLocatorReference(options.codes, reference).ok) continue;
        const url = options.canvasUrlForCode(reference);
        if (url === null) continue;
        links.push(`[${suffix}](${url})`);
    }
    return links;
}

function authorshipWord(card: ReportCard): string {
    return card.authorship === "authored" ? "authored" : "AI";
}

function relationSentence(out: Emitter, relation: ReportRelation): string {
    const origin = relation.origin === "hand-drawn"
        ? "hand-drawn"
        : relation.origin === "model-derived"
            ? "AI"
            : "origin unknown";
    const evidence = relation.similarity !== null
        ? `, cos ${relation.similarity.toFixed(2)}${relation.similarityMargin !== null ? `, margin ${relation.similarityMargin.toFixed(2)}` : ""}`
        : "";
    return `${ref(out, relation.sourceCode)} —${relation.label}→ ${ref(out, relation.targetCode)} (${origin}${evidence})`;
}

/**
 * The cards a section prints, and how many it leaves to the appendix.
 *
 * One place, because the sentence has to be true of every section that says it and the trap is the
 * same each time: `emphasised` is a **union** across overlapping containers — an insight can be cut
 * from its thread and kept by the Insights sweep — so the printed set is not "the N most central" and
 * must not claim to be. What is honest, and what a reader can act on, is the count and where the rest
 * are.
 */
function emphasisSplit(cards: ReportCard[]): { shown: ReportCard[]; omitted: number } {
    const shown = cards.filter((card) => card.emphasised);
    return { shown, omitted: cards.length - shown.length };
}

/** Both forms are given because the noun is a phrase — "card in this thread" pluralises in the middle. */
function omissionNote(omitted: number, singular: string, pluralForm: string): string {
    return `_${plural(omitted, `further ${singular}`, `further ${pluralForm}`)}`
        + ` ${omitted === 1 ? "is" : "are"} named under **Also indexed** in Appendix A rather than`
        + " printed here._";
}

function cardRows(out: Emitter, cards: ReportCard[]): string[][] {
    return cards.map((card) => [
        ref(out, card.code),
        tableCell(card.label),
        tableCell(card.title),
        authorshipWord(card),
        card.quotation.trim() !== "" ? "quoted" : "—",
        formatIsoDay(card.createdAtIso),
    ]);
}

function renderThread(out: Emitter, thread: ReportThread, depth: number): void {
    const title = thread.code !== null
        ? `${thread.code} · ${thread.title}`
        : thread.title;
    heading(out, depth, title, thread.code, `activity — ${thread.title}`);

    // An activity the researcher set aside still organises the cards under it, so the section stays —
    // but the reader has to be told, or the document silently features work the study ruled out. See
    // `ReportThread.relevant`.
    if (!thread.relevant) {
        push(out, "_The researcher marked this activity not relevant. Its section is kept because the"
            + " cards below it were not set aside and have nowhere else to be listed._");
        blank(out);
    }

    // Who was there, and nothing else. The date and the two counts that used to run along this line
    // are all derivable from the table below it and from the relation lines under that, and a reader
    // arriving at a thread wants to know whose thread it was before they want its arithmetic.
    if (thread.participants.length > 0) {
        push(out, `Participants: ${thread.participants.join(", ")}`);
        blank(out);
    }

    if (thread.headline.length > 0) {
        push(out, "What this thread is organised around, most central first:");
        blank(out);
        for (const card of thread.headline) {
            push(out, `- ${ref(out, card.code)} **${card.title}** — ${card.label}, ${authorshipWord(card)}`);
        }
        blank(out);
    }

    const { shown: threadCards, omitted: threadOmitted } = emphasisSplit(thread.cards);
    if (threadCards.length > 0) {
        push(out, ...table(
            ["Code", "Type", "Title", "Author", "Evidence", "First seen"],
            cardRows(out, threadCards),
        ));
        blank(out);

        // Descriptions in full, below the table, because a table cell must not be the place a
        // researcher's own words get squeezed.
        const described = threadCards.filter((card) => card.description.trim() !== "");
        if (described.length > 0) {
            for (const card of described) {
                push(out, `${ref(out, card.code)} **${card.title}**`);
                blank(out);
                push(out, quoteBlock(card.description));
                blank(out);
            }
        }
    }
    if (threadOmitted > 0) {
        push(out, omissionNote(threadOmitted, "card in this thread", "cards in this thread"));
        blank(out);
    }

    // Only the relations that leave. A thread's internal wiring is the table above it said twice —
    // every card in it is already listed, and the edges between them are what put them there. What is
    // not derivable from the table is where this thread reached to, which is the whole question the
    // phase structure exists to answer.
    if (thread.outboundRelations.length > 0) {
        push(out, `Reaching beyond it: ${thread.outboundRelations.map((relation) => relationSentence(out, relation)).join(" · ")}`);
        blank(out);
    }
}

export function renderReportMarkdown(model: ReportModel, options: ReportOptions): string {
    const out: Emitter = { lines: [], taken: new Map(), definitions: new Map(), cited: new Set() };
    const { snapshot } = model;
    // Over what the document contains, not over the whole live graph: `allCards` deliberately keeps
    // the set-aside cards so they can be named under "Set aside", and counting them here would have
    // the front matter promise a card count the body never delivers.
    const authorship = buildAuthorshipTally(
        model.allCards.filter((card) => card.relevant),
        model.relations,
    );
    const threadCount = model.phases.reduce((sum, phase) => sum + phase.threads.length, 0)
        + model.looseThreads.length;
    // Counted over exactly the set `buildAuthorshipTally` counts — relevant, non-person — so the two
    // halves of the Contents row are talking about the same cards. A total the reader cannot
    // reconcile with the number beside it is worse than no total at all.
    const namedOnly = model.allCards.filter((card) => (
        card.relevant && card.label !== "person" && !card.emphasised
    )).length;

    // --- Title and front matter ------------------------------------------------------------------
    push(out, `# ${snapshot.projectTitle}`);
    blank(out);
    push(out, ...table(["", ""], [
        ["Exported", tableCell(formatIsoMinute(snapshot.generatedAtIso))],
        ["Describes the project as of", tableCell(
            snapshot.asOf.version === null
                ? formatIsoMinute(snapshot.asOf.capturedAtIso)
                : `${formatIsoMinute(snapshot.asOf.capturedAtIso)} (revision ${snapshot.asOf.version})`,
        )],
        ["Content fingerprint", `\`${tableCell(snapshot.contentVersion)}\``],
        ["Contents", tableCell(
            `${plural(model.phases.length, "phase")} · ${plural(threadCount, "thread")} · `
            + `${plural(authorship.cards.total, "card")} · ${plural(authorship.relations.total, "relation")}`
            // Said here rather than only per section, because it is a fact about the whole file and a
            // reader deciding whether to trust it as a record should meet it before anything else.
            + (namedOnly > 0
                ? ` (${namedOnly} of those cards are named under **Also indexed** rather than printed in full)`
                : ""),
        )],
    ]));
    blank(out);

    // --- The system, as it last stood -------------------------------------------------------------
    //
    // Above the abstract, and with no heading of its own.
    //
    // A design study report is about a thing that was built, and the abstract is the first place
    // that thing is described in words. A reader who has seen it first reads those words about
    // something; a reader who has not is being asked to hold a description of an interface they have
    // never laid eyes on. So the picture comes first, in the one position where it is unavoidable
    // and still not in the way.
    //
    // No heading, because a heading here would claim an outline slot and a slug between the metadata
    // table and `## Abstract`, and this is a figure rather than a section. The caption carries the
    // date instead, which is the only thing about it a reader has to be told.
    const latestScreenshot = snapshot.timeline.latestScreenshot;
    if (latestScreenshot) {
        // `formatIsoDay` answers an em dash for an instant it cannot parse, and "The system as it
        // stood on —" is worse than not naming a day at all. A marker whose timestamp is unreadable
        // is still a picture of the system.
        const day = formatIsoDay(latestScreenshot.occurredAtIso);
        const caption = day === "—" ? "The system as it last stood" : `The system as it stood on ${day}`;
        blank(out);
        // The alt text is the caption's sentence rather than "screenshot": it is what a reader
        // without the image gets, and "screenshot" tells them nothing they could not infer.
        push(out, `![${caption}](${latestScreenshot.imageDataUrl})`);
        blank(out);
        push(out, `_${caption}._`);
        blank(out);
    }

    // --- Abstract ---------------------------------------------------------------------------------
    heading(out, 2, "Abstract", null);
    if (options.abstract) {
        // Sentinel comments: invisible in every renderer (`react-markdown` skips raw HTML without
        // `rehype-raw`), and they make the machine-written block findable and removable by a script.
        push(out, `<!-- ${MACHINE_TEXT_BEGIN} model=${options.abstract.model} prompt=${options.abstract.prompt} -->`);
        machineProse(out, options.abstract.prose.trim());
        blank(out);
        push(out, `<!-- ${MACHINE_TEXT_END} -->`);
    } else {
        push(out, "_No machine-written framing was included in this export._");
    }
    blank(out);

    // --- The material ------------------------------------------------------------------------------
    //
    // One paragraph per kind of card, before the reader meets any of them. It sits here, with the
    // abstract, because it answers the question that comes before "what happened": what sort of
    // material is this study made of. Bold lead-ins rather than headings on purpose — six more
    // headings would swamp the outline, and each of them would claim a slug that the real sections
    // further down (`## Insights`, `## Concepts`) already want.
    //
    // Its own sentinels, so a script can strip the machine-written text without having to know that
    // this document now has two such blocks rather than one.
    const cardTypeNotes = options.cardTypeNotes;
    const notedTypes = cardTypeNotes
        ? REPORT_CARD_TYPES.filter((type) => (cardTypeNotes.notes[type] ?? "").trim() !== "")
        : [];
    if (notedTypes.length > 0 && cardTypeNotes) {
        heading(out, 2, "The material", null);
        push(out, `<!-- ${CARD_TYPE_TEXT_BEGIN} model=${cardTypeNotes.model} prompt=${cardTypeNotes.prompt} -->`);
        blank(out);
        for (const type of notedTypes) {
            machineProse(out, `**${REPORT_CARD_TYPE_HEADING[type]}** — ${cardTypeNotes.notes[type]!.trim()}`);
            blank(out);
        }
        push(out, `<!-- ${CARD_TYPE_TEXT_END} -->`);
        blank(out);
    }

    // --- Overview ---------------------------------------------------------------------------------
    heading(out, 2, "Overview", null);

    heading(out, 3, "Project goal", null);
    push(out, snapshot.projectGoal.trim() !== ""
        ? quoteBlock(snapshot.projectGoal)
        : "_No goal was recorded for this project._");
    blank(out);

    if (model.phases.length > 0) {
        heading(out, 3, "Phases at a glance", null);
        push(out, ...table(["Code", "Phase", "Dates", "Threads"],
            model.phases.map((phase) => [
                ref(out, phase.code),
                tableCell(phase.label),
                tableCell(formatDayRange(phase.startIso, phase.endIso)),
                String(phase.threads.length),
            ])));
        blank(out);
    }

    // --- Participants -----------------------------------------------------------------------------
    if (model.participants.length > 0) {
        heading(out, 2, "Participants", null);
        push(out, ...table(["Name", "Role"], model.participants.map((entry) => [
            tableCell(entry.name),
            tableCell(entry.role),
        ])));
        blank(out);
    }

    // --- Phases and threads -----------------------------------------------------------------------
    heading(out, 2, "Phases and threads", null);
    if (model.phases.length === 0 && model.looseThreads.length === 0) {
        push(out, "_This project has no activities yet, so it has no threads._");
        blank(out);
    }

    for (const phase of model.phases) {
        const phaseTitle = phase.code !== null ? `${phase.code} · ${phase.label}` : phase.label;
        heading(out, 3, phaseTitle, phase.code, `phase — ${phase.label}`);

        push(out, ...table(["", ""], [
            ["Dates", tableCell(`${formatDayRange(phase.startIso, phase.endIso)}${(() => {
                const days = daysBetween(phase.startIso, phase.endIso);
                // Omitted at zero: "(0 days)" beside a single date reads as an error rather than as
                // a phase that happened in one day.
                return days === null || days === 0 ? "" : ` (${plural(days, "day")})`;
            })()}`)],
            ["Anchor activity", ref(out, phase.anchorCode)],
            ["Participants", tableCell(phase.participants.join(", ") || "—")],
        ]));
        blank(out);

        if (phase.headline.length > 0) {
            push(out, "What this phase is organised around:");
            blank(out);
            for (const card of phase.headline) {
                push(out, `- ${ref(out, card.code)} **${card.title}** — ${card.label}, ${authorshipWord(card)}`);
            }
            blank(out);
        }

        for (const thread of phase.threads) renderThread(out, thread, 4);
    }

    for (const thread of model.looseThreads) renderThread(out, thread, 3);

    // --- Unconnected cards ------------------------------------------------------------------------
    if (model.unassignedCards.length > 0) {
        const { shown, omitted } = emphasisSplit(model.unassignedCards);
        heading(out, 2, "Unconnected cards", null);
        push(out, "Cards that reach no activity. The canvas draws them in a band of their own; they are"
            + " listed here rather than dropped, because the fact that they are unattached is itself"
            + " part of the record.");
        blank(out);
        if (shown.length > 0) {
            push(out, ...table(
                ["Code", "Type", "Title", "Author", "Evidence", "First seen"],
                cardRows(out, shown),
            ));
            blank(out);
        }
        if (omitted > 0) {
            push(out, omissionNote(omitted, "unconnected card", "unconnected cards"));
            blank(out);
        }
    }

    // --- Relations between phases -----------------------------------------------------------------
    if (model.crossPhaseRelations.length > 0) {
        heading(out, 2, "Relations between phases", null);
        push(out, "Connections whose two ends sit in different phases — the places where the study"
            + " doubled back on itself.");
        blank(out);
        for (const relation of model.crossPhaseRelations) {
            push(out, `- ${relationSentence(out, relation)}`);
        }
        blank(out);
    }

    // --- Requirements and their answers -----------------------------------------------------------
    heading(out, 2, "Requirements and their answers", null);
    // The guard is on the *answers*, not on the requirements. The line that used to close this
    // section — "Not yet answered by any component: ..." — was removed on request, and with it the
    // only thing the false branch had to emit for a project that has requirements but has not
    // attached a component to any of them. That is every project until somebody attaches one, and
    // without this the section would be a heading with nothing under it.
    if (model.requirementAnswers.length === 0) {
        push(out, model.unansweredRequirements.length === 0
            ? "_No requirement cards in this project._"
            : "_No system component has been attached to a requirement in this project yet._");
        blank(out);
    }
    for (const answer of model.requirementAnswers) {
        push(out, `**${ref(out, answer.requirement.code)} ${answer.requirement.title}** — answered by:`);
        blank(out);
        for (const component of answer.components) {
            const source = component.paperTitle ? ` (from _${component.paperTitle}_)` : "";
            push(out, `- ${ref(out, component.card.code)} **${component.card.title}**${source}`
                + (component.attachedAtIso ? `, attached ${formatIsoDay(component.attachedAtIso)}` : ""));
            if (component.referenceCitation && component.referenceCitation.trim() !== "") {
                push(out, "");
                push(out, quoteBlock(component.referenceCitation));
            }
        }
        blank(out);
    }
    // The line that used to close this section — "Not yet answered by any component: ..." — was
    // removed on request. `model.unansweredRequirements` stays, because the abstract's payload marks
    // each requirement `answered` and the empty-section sentence above reads it.

    // --- Insights and concepts --------------------------------------------------------------------
    if (model.insights.length > 0) {
        const { shown, omitted } = emphasisSplit(model.insights);
        heading(out, 2, "Insights", null);
        push(out, "The findings, most central first, in the researcher's own words.");
        blank(out);
        for (const card of shown) {
            push(out, `**${ref(out, card.code)} ${card.title}** — ${authorshipWord(card)}`);
            blank(out);
            if (card.description.trim() !== "") {
                push(out, quoteBlock(card.description));
                blank(out);
            }
        }
        if (omitted > 0) {
            push(out, omissionNote(omitted, "insight", "insights"));
            blank(out);
        }
    }

    if (model.concepts.length > 0) {
        const { shown, omitted } = emphasisSplit(model.concepts);
        heading(out, 2, "Concepts", null);
        // Filtered like every other section, and this one has to be: the Description column carries a
        // concept's words in full, so leaving it unfiltered would print the very text the
        // `Also indexed` line promises is not in this file.
        push(out, ...table(["Code", "Concept", "Author", "Description"],
            shown
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((card) => [
                    ref(out, card.code),
                    tableCell(card.title),
                    authorshipWord(card),
                    tableCell(card.description),
                ])));
        blank(out);
        if (omitted > 0) {
            push(out, omissionNote(omitted, "concept", "concepts"));
            blank(out);
        }
    }

    // --- Timeline ----------------------------------------------------------------------------------
    heading(out, 2, "Timeline", null);
    push(out, `Project span: ${formatDayRange(snapshot.timeline.startIso, snapshot.timeline.endIso)}.`);
    blank(out);
    if (snapshot.timeline.stages.length > 0) {
        push(out, ...table(["Stage", "From", "To"], snapshot.timeline.stages.map((stage) => [
            tableCell(stage.name),
            formatIsoDay(stage.startIso),
            formatIsoDay(stage.endIso),
        ])));
        blank(out);
    }
    if (snapshot.timeline.designStudyEvents.length > 0) {
        push(out, ...table(["Milestone", "When", "Recorded by"],
            snapshot.timeline.designStudyEvents.map((event) => [
                tableCell(event.name),
                formatIsoDay(event.occurredAtIso),
                // Rendered, because an LLM-proposed milestone must not read as a recorded fact.
                event.generatedBy === "llm" ? "proposed by a model" : "a person",
            ])));
        blank(out);
    }
    const activeSubtracks = snapshot.timeline.codebaseSubtracks;
    if (activeSubtracks.length > 0) {
        push(out, ...table(["Codebase subtrack", "Status", "Files"], activeSubtracks.map((subtrack) => [
            tableCell(subtrack.name),
            subtrack.inactive ? "finished" : "active",
            tableCell(subtrack.filePaths.join(", ")),
        ])));
        blank(out);
    }
    if (snapshot.timeline.screenshotMarkers.length > 0) {
        // The sentence has to know about the figure at the top, or it contradicts it. One image is
        // carried now; the rest of the set still is not, and a reader counting seven dates against
        // one picture deserves to be told which of the two the document holds.
        push(out, `${plural(snapshot.timeline.screenshotMarkers.length, "system screenshot")} recorded, on `
            + `${snapshot.timeline.screenshotMarkers.map((marker) => formatIsoDay(marker.occurredAtIso)).join(", ")}. `
            + (snapshot.timeline.latestScreenshot
                ? "The most recent image is reproduced above the abstract; the earlier ones are not embedded here."
                : "The images themselves are not embedded here."));
        blank(out);
    }

    // --- Provenance --------------------------------------------------------------------------------
    //
    // What is left here is the one thing the graph cannot show on its own: what was kept but ruled out
    // of the study. The computed tallies that used to sit above it — authorship counts, the salience
    // weights, the relation-origin table, the revision summary — were removed on request. Each restated
    // a mark that every card and every relation already carries individually in the body, so a reader
    // who doubted a number had to go and check it against the study regardless. The deletion table
    // — "Removed from the study" — was removed on request too, and with the appendix's dead-code list
    // gone as well, a deleted card is now absent from the document entirely. `model.removedCards` and
    // `model.removedRelations` stay: the stats count them, and the live sets are derived by
    // subtracting them.
    heading(out, 2, "Provenance", null);

    heading(out, 3, "Set aside", null);
    if (model.setAsideCards.length === 0) {
        push(out, "No cards have been marked not relevant.");
    } else {
        push(out, "Cards the researcher kept but marked not relevant. That is a judgement about the"
            + " material, so it is recorded rather than silently applied.");
        blank(out);
        push(out, ...table(["Code", "Type", "Title"], model.setAsideCards.map((card) => [
            card.code ?? "—",
            tableCell(card.label),
            tableCell(card.title),
        ])));
    }
    blank(out);

    // --- Appendices ---------------------------------------------------------------------------------
    if (options.includeAppendices) {
        heading(out, 2, "How to read a reference", null);
        push(out, ...referenceMechanismLines());
        blank(out);

        heading(out, 2, "Appendix A. Card index", null);
        push(out, "Every artifact this document can name, with its code. This is where the codes used"
            + " above resolve to, and where a code cited in a paper can be looked up.");
        blank(out);

        // The index has the document's two registers in it, and this is where the difference is
        // visible: an entry of its own, or a line under **Also indexed**. Both are collected in the
        // same pass over the same sorted list, so a card cannot fall between them.
        const indexed = model.allCards
            .slice()
            .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))
            .filter((card) => card.code !== null && card.relevant);
        const alsoIndexed: ReportCard[] = [];

        for (const card of indexed) {
            // An activity already has a heading of its own — its thread section. A second one here
            // would claim the same slug, and `headingSlug` would silently hand it `a3-1`, so half the
            // links to `A3` would land in the appendix and half in the narrative.
            if (card.label === "activity") continue;
            if (!card.emphasised) { alsoIndexed.push(card); continue; }
            heading(out, 3, card.code!, card.code, `${card.label} — ${card.title}`);
            push(out, `**${card.title}** — ${card.label}, ${authorshipWord(card)}, first seen ${formatIsoDay(card.createdAtIso)}`);
            blank(out);
            if (card.description.trim() !== "") {
                push(out, quoteBlock(card.description));
                blank(out);
            }
            if (card.quotation.trim() !== "") {
                push(out, "Quoted from its source:");
                blank(out);
                push(out, quoteBlock(card.quotation));
                blank(out);
            }
            // The code itself opens the card; the letters beside it open the further views of it.
            // One line rather than two, because they are one gesture with four destinations, and a
            // reader scanning the index should be able to take the whole of it in at a glance.
            const url = options.canvasUrlForCode?.(card.code!) ?? null;
            if (url !== null) {
                const hasAttachment = card.attachmentIds.some((id) => (
                    snapshot.files.some((file) => file.id === id)
                ));
                const steps = nextStepLinks(card, options, hasAttachment);
                const suffixed = steps.length > 0 ? ` (${steps.join(" / ")})` : "";
                push(out, `On the canvas: [${card.code}](${url})${suffixed}`);
                blank(out);
            }
        }

        // The other register. One line per card the document names but does not print, so the study's
        // full extent is still readable off this file even where its text is not.
        //
        // Deliberately **not** headings. A heading per card would put the whole index back into the
        // document's outline — the thing this section exists to stop growing — and it would claim a
        // slug, which is how a code comes to link to a line that says nothing about it. Deliberately
        // **no canvas link** either: the test that forbids raw uuids in the prose exempts exactly one
        // line shape, `On the canvas: ...`, and that exemption is a contract rather than an accident.
        // These codes still work when typed into the application, which the reference section says.
        //
        // The loud-failure rule does the rest: a code cited in the body with no heading to point at is
        // rewritten to plain `R7` by the pass below, rather than left as a link that looks broken.
        if (alsoIndexed.length > 0) {
            heading(out, 3, "Also indexed", null);
            push(out, "Cards this study holds that the document names but does not print in full."
                + " Their descriptions and source quotations are in the project rather than in this"
                + " file, and their codes resolve on the canvas exactly like the ones above.");
            blank(out);
            for (const card of alsoIndexed) {
                push(out, `- \`${card.code}\` ${card.label} — ${tableCell(card.title)}`);
            }
            blank(out);
        }

        if (snapshot.files.length > 0) {
            heading(out, 2, "Appendix B. Sources", null);
            push(out, ...table(["Code", "File", "Type", "Size", "Added"],
                snapshot.files.map((file) => [
                    ref(out, options.codes.byTargetId.get(file.sha256)?.code ?? null),
                    tableCell(file.name),
                    tableCell(file.ext || file.mimeType),
                    `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
                    formatIsoDay(file.createdAtIso),
                ])));
            blank(out);
        }
    }

    // --- Link reference definitions -----------------------------------------------------------------
    // Emitted by the same pass that wrote the headings, so a link and its target come from one string.
    blank(out);
    const definitions = Array.from(out.definitions.entries())
        .filter(([code]) => out.cited.has(code))
        .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [code, entry] of definitions) {
        push(out, `[${code}]: #${entry.slug} "${entry.title.replace(/"/g, "'")}"`);
    }

    let markdown = `${out.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;

    // A cited code with no heading to point at would render as a literal `[R7]` — a link that
    // looks broken rather than one that says why. Those become plain code text instead, which is
    // what the rest of the app does with a reference it can name but not open.
    const unlinkable = Array.from(out.cited).filter((code) => !out.definitions.has(code)).sort();
    for (const code of unlinkable) {
        markdown = markdown.split(`[${code}]`).join(`\`${code}\``);
    }

    return markdown;
}
