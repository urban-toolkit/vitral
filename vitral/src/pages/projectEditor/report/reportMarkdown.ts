import {
    describeLocatorStatus,
    LOCATOR_LENS_HELP,
    LOCATOR_LENS_SUFFIX,
    LOCATOR_NEXT_STEP_LENSES,
    resolveLocatorReference,
} from "@/pages/projectEditor/locators";
import type { ReportCard, ReportModel, ReportRelation, ReportThread } from "./reportModel";
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
 * ## What is never done here
 *
 * Nothing is truncated, nothing is summarised, and nothing is dropped for length. The document the
 * reviewers saw was superficial because it summarised; length is the cheaper problem, and appendices
 * are where it goes.
 */

const MACHINE_TEXT_BEGIN = "vitral:abstract:begin";
const MACHINE_TEXT_END = "vitral:abstract:end";

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
        + " cards, so they are Detail claims. A code links to its entry in the index below and, where"
        + " a canvas link is available, to the same artifact on the canvas at that altitude.",
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
        "**In this document**, each entry in the index below is followed by the further views"
        + " available for it, written `R1 (P / A / T / F)`. A letter appears only where there is"
        + " something to show: a card with no attached file has no `F`, and a card that belongs to no"
        + " thread has no `P`, `A` or `T`.",
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

    if (thread.cards.length > 0) {
        push(out, ...table(
            ["Code", "Type", "Title", "Author", "Evidence", "First seen"],
            cardRows(out, thread.cards),
        ));
        blank(out);

        // Descriptions in full, below the table, because a table cell must not be the place a
        // researcher's own words get squeezed.
        const described = thread.cards.filter((card) => card.description.trim() !== "");
        if (described.length > 0) {
            for (const card of described) {
                push(out, `${ref(out, card.code)} **${card.title}**`);
                blank(out);
                push(out, quoteBlock(card.description));
                blank(out);
            }
        }
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
            + `${plural(authorship.cards.total, "card")} · ${plural(authorship.relations.total, "relation")}`,
        )],
    ]));
    blank(out);

    // --- Abstract ---------------------------------------------------------------------------------
    heading(out, 2, "Abstract", null);
    if (options.abstract) {
        // Sentinel comments: invisible in every renderer (`react-markdown` skips raw HTML without
        // `rehype-raw`), and they make the machine-written block findable and removable by a script.
        push(out, `<!-- ${MACHINE_TEXT_BEGIN} model=${options.abstract.model} prompt=${options.abstract.prompt} -->`);
        push(out, options.abstract.prose.trim());
        blank(out);
        push(out, `<!-- ${MACHINE_TEXT_END} -->`);
    } else {
        push(out, "_No machine-written framing was included in this export._");
    }
    blank(out);

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
        heading(out, 2, "Unconnected cards", null);
        push(out, "Cards that reach no activity. The canvas draws them in a band of their own; they are"
            + " listed here rather than dropped, because the fact that they are unattached is itself"
            + " part of the record.");
        blank(out);
        push(out, ...table(
            ["Code", "Type", "Title", "Author", "Evidence", "First seen"],
            cardRows(out, model.unassignedCards),
        ));
        blank(out);
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
    if (model.requirementAnswers.length === 0 && model.unansweredRequirements.length === 0) {
        push(out, "_No requirement cards in this project._");
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
    if (model.unansweredRequirements.length > 0) {
        push(out, `Not yet answered by any component: ${model.unansweredRequirements.map((card) => `${ref(out, card.code)} ${card.title}`).join(" · ")}`);
        blank(out);
    }

    // --- Insights and concepts --------------------------------------------------------------------
    if (model.insights.length > 0) {
        heading(out, 2, "Insights", null);
        push(out, "The findings, most central first, in the researcher's own words.");
        blank(out);
        for (const card of model.insights) {
            push(out, `**${ref(out, card.code)} ${card.title}** — ${authorshipWord(card)}`);
            blank(out);
            if (card.description.trim() !== "") {
                push(out, quoteBlock(card.description));
                blank(out);
            }
        }
    }

    if (model.concepts.length > 0) {
        heading(out, 2, "Concepts", null);
        push(out, ...table(["Code", "Concept", "Author", "Description"],
            model.concepts
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((card) => [
                    ref(out, card.code),
                    tableCell(card.title),
                    authorshipWord(card),
                    tableCell(card.description),
                ])));
        blank(out);
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
        push(out, `${plural(snapshot.timeline.screenshotMarkers.length, "system screenshot")} recorded, on `
            + `${snapshot.timeline.screenshotMarkers.map((marker) => formatIsoDay(marker.occurredAtIso)).join(", ")}. `
            + "The images themselves are not embedded here.");
        blank(out);
    }

    // --- Provenance --------------------------------------------------------------------------------
    //
    // What is left here is the two things the graph cannot show on its own: what was taken out of the
    // study, and what was kept but ruled out of it. The computed tallies that used to sit above them —
    // authorship counts, the salience weights, the relation-origin table, the revision summary — were
    // removed on request. Each restated a mark that every card and every relation already carries
    // individually in the body, so a reader who doubted a number had to go and check it against the
    // study regardless.
    heading(out, 2, "Provenance", null);

    heading(out, 3, "Removed from the study", null);
    if (model.removedCards.length === 0 && model.removedRelations.length === 0) {
        push(out, "Nothing has been removed from this project.");
    } else {
        push(out, "Cards and connections the researcher deleted. They are kept because what a study"
            + " rejected is part of how it reached what it kept.");
        blank(out);
        if (model.removedCards.length > 0) {
            push(out, ...table(["Code", "Type", "Title", "Created", "Removed"],
                model.removedCards.map((card) => [
                    ref(out, card.code),
                    tableCell(card.label),
                    tableCell(card.title),
                    formatIsoDay(card.createdAtIso),
                    formatIsoDay(card.deletedAtIso),
                ])));
            blank(out);
        }
        if (model.removedRelations.length > 0) {
            push(out, `${plural(model.removedRelations.length, "connection")} were also removed.`);
        }
    }
    blank(out);

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

        for (const card of model.allCards.slice().sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))) {
            if (card.code === null) continue;
            if (!card.relevant) continue;
            // An activity already has a heading of its own — its thread section. A second one here
            // would claim the same slug, and `headingSlug` would silently hand it `a3-1`, so half the
            // links to `A3` would land in the appendix and half in the narrative.
            if (card.label === "activity") continue;
            heading(out, 3, card.code, card.code, `${card.label} — ${card.title}`);
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
            const url = options.canvasUrlForCode?.(card.code) ?? null;
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

        // Codes whose target the document cannot anchor still get an entry, stating why. A reference
        // that cannot resolve must say so rather than look clickable.
        //
        // A live target with no anchor is the set-aside case, and it needs its own sentence:
        // `describeLocatorStatus` takes its "live" branch and would print the card's title under a
        // heading saying the code does not resolve — reproducing in the appendix exactly the content
        // the researcher's judgement kept out of the body.
        //
        // `out.definitions` is the check, not `inDocument` alone: a set-aside **activity** does still
        // get a heading, because its thread section organises cards that were not set aside
        // (`ReportThread.relevant`). Asking what the document actually anchored, rather than what the
        // index predicted it would, is what stops the appendix denying a section three pages up — and
        // it will stay right for whatever the next exception turns out to be.
        const unresolvable = options.codes.entries.filter((entry) => (
            (entry.status !== "live" || !entry.inDocument) && !out.definitions.has(entry.code)
        ));
        if (unresolvable.length > 0) {
            heading(out, 3, "Codes that no longer resolve", null);
            for (const entry of unresolvable) {
                const why = entry.status === "live"
                    ? "was set aside by the researcher, so it has no entry above. It is listed under"
                        + " **Set aside**."
                    : describeLocatorStatus(entry);
                push(out, `- \`${entry.code}\` — ${why}`);
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
