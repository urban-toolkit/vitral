import { describeLocatorStatus } from "@/pages/projectEditor/locators";
import type { ReportCard, ReportModel, ReportRelation, ReportThread } from "./reportModel";
import {
    buildAuthorshipTally,
    buildRelationKindTallies,
    buildRevisionSummary,
    salienceWeightRows,
} from "./reportProvenance";
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

    const facts = [
        formatIsoDay(thread.createdAtIso),
        plural(thread.cards.length, "card"),
        thread.participants.length > 0 ? `with ${thread.participants.join(", ")}` : null,
        thread.outboundRelations.length > 0
            ? `${plural(thread.outboundRelations.length, "relation")} reaching other threads`
            : null,
    ].filter((part): part is string => part !== null);
    push(out, facts.join(" · "));
    blank(out);

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

    if (thread.internalRelations.length > 0) {
        push(out, `Relations inside this thread: ${thread.internalRelations.map((relation) => relationSentence(out, relation)).join(" · ")}`);
        blank(out);
    }
    if (thread.outboundRelations.length > 0) {
        push(out, `Reaching beyond it: ${thread.outboundRelations.map((relation) => relationSentence(out, relation)).join(" · ")}`);
        blank(out);
    }
    if (thread.setAside.length > 0) {
        push(out, `Set aside by the researcher: ${thread.setAside.map((card) => `${ref(out, card.code)} ${card.title}`).join(" · ")}`);
        blank(out);
    }
}

export function renderReportMarkdown(model: ReportModel, options: ReportOptions): string {
    const out: Emitter = { lines: [], taken: new Map(), definitions: new Map(), cited: new Set() };
    const { snapshot } = model;
    const authorship = buildAuthorshipTally(model.allCards, model.relations);
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
    push(
        out,
        "Everything in this document except the Abstract is computed from the project graph. Each"
        + " artifact carries a short code — `A3`, `R7`, `P1` — which links to its entry here and, where"
        + " a canvas link is available, to the same artifact on the canvas at the same level of"
        + " abstraction. See **Appendix A** for the full index.",
    );
    blank(out);

    // --- Abstract ---------------------------------------------------------------------------------
    heading(out, 2, "Abstract", null);
    if (options.abstract) {
        // Sentinel comments: invisible in every renderer (`react-markdown` skips raw HTML without
        // `rehype-raw`), and they make the machine-written block findable and removable by a script.
        push(out, `<!-- ${MACHINE_TEXT_BEGIN} model=${options.abstract.model} prompt=${options.abstract.prompt} -->`);
        push(
            out,
            "_Machine-written from the figures in this document. Every other section is computed from"
            + " the project graph. Deleting this section removes all machine-written text._",
        );
        blank(out);
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
        push(out, ...table(["Code", "Phase", "Dates", "Threads", "Cards"],
            model.phases.map((phase) => [
                ref(out, phase.code),
                tableCell(phase.label),
                tableCell(formatDayRange(phase.startIso, phase.endIso)),
                String(phase.threads.length),
                String(phase.cardCount),
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
            ["Contains", tableCell(`${plural(phase.threads.length, "thread")} · ${plural(phase.cardCount, "card")}`)],
            ["Composition", tableCell(phase.composition.map((entry) => `${entry.count} ${entry.label}`).join(", ") || "—")],
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
    heading(out, 2, "Provenance", null);

    heading(out, 3, "How this document was made", null);
    push(out,
        "Every section above except the Abstract is computed from the project graph by the same"
        + " functions the canvas uses to draw it, so the document and the canvas cannot disagree about"
        + " what the study contains.");
    blank(out);
    push(out,
        "- **Phases** are runs of consecutive activities, cut where the gap in time outweighs the"
        + " content the activities share. A cut is only made where that difference is positive, so a"
        + " project with steady work and connected activities is one phase.\n"
        + "- **Threads** are activity trees: every card is assigned to the nearest activity it can"
        + " reach through the graph, with the earlier activity winning a tie. A card reaching none is"
        + " listed under \"Unconnected cards\".\n"
        + "- **Ordering** everywhere is by one salience score, printed below.\n"
        + "- **`referenced by` and `iteration of`** relations were thresholded cosine similarity"
        + " frozen at the moment the card was created. They are not a live model's opinion, and the"
        + " score that carried each decision is shown beside it.\n"
        + "- **Filters are ignored.** This document describes the project, not the researcher's"
        + " current screen, so label chips, the search query and the timeline playhead have no effect"
        + " on what appears here.");
    blank(out);
    push(out,
        "_One honest discrepancy: this document assigns a card to a thread by walking the graph to the"
        + " nearest activity at any distance, while the server's provenance database follows only"
        + " direct activity-to-card connections. For a card more than one step from its activity the two"
        + " can disagree. The canvas's definition is the one used here._");
    blank(out);

    heading(out, 3, "Authorship", null);
    push(out, "Who put each thing on the canvas. This is a count of the same mark every card and every"
        + " relation carries individually above, so any row here can be checked against the study.");
    blank(out);
    push(out, ...table(["Kind", "Authored", "AI", "Total"], [
        ...authorship.cards.byLabel.map((row) => [
            tableCell(row.label),
            String(row.authored),
            String(row.modelProposed),
            String(row.authored + row.modelProposed),
        ]),
        ["**all cards**", `**${authorship.cards.authored}**`, `**${authorship.cards.modelProposed}**`, `**${authorship.cards.total}**`],
    ]));
    blank(out);
    push(out, `Relations: ${authorship.relations.handDrawn} hand-drawn, `
        + `${authorship.relations.modelDerived} by AI, and ${authorship.relations.unknown} whose origin `
        + "predates the marker that records it — counted as unknown rather than assumed to be either.");
    blank(out);

    heading(out, 3, "Emphasis, as a formula", null);
    push(out, ...table(["Term", "Weight", "What it means"], salienceWeightRows().map((row) => [
        `\`${row.term}\``,
        row.weight.toFixed(2),
        tableCell(row.means),
    ])));
    blank(out);
    push(out, "`degree`, `crossTree` and `iteration` are proportions of the highest value in this"
        + " project; the rest are flat. `authored` is why a card a person wrote is named before one a"
        + " model proposed when the two are equally central.");
    blank(out);

    heading(out, 3, "Relations by kind and origin", null);
    push(out, ...table(["Kind", "Total", "Hand-drawn", "AI", "Unknown", "Similarity (min/median/max)"],
        buildRelationKindTallies(model.relations).map((row) => [
            tableCell(row.kind),
            String(row.count),
            String(row.handDrawn),
            String(row.modelDerived),
            String(row.unknown),
            row.similarity
                ? `${row.similarity.min.toFixed(2)} / ${row.similarity.median.toFixed(2)} / ${row.similarity.max.toFixed(2)}`
                : "—",
        ])));
    blank(out);

    const revisions = buildRevisionSummary(model.allCards);
    heading(out, 3, "How much the material was worked", null);
    push(out, `${plural(revisions.cardsEditedAfterCreation, "card")} were edited after being created and`
        + ` ${revisions.cardsNeverEdited} were not, over ${plural(revisions.totalDataRevisions, "recorded edit")}.`);
    blank(out);
    if (revisions.mostRevised.length > 0) {
        push(out, ...table(["Code", "Card", "Edits"], revisions.mostRevised.map((row) => [
            ref(out, row.code),
            tableCell(row.title),
            String(row.revisions),
        ])));
        blank(out);
    }

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
            const url = options.canvasUrlForCode?.(card.code) ?? null;
            if (url !== null) {
                push(out, `[Open on the canvas](${url})`);
                blank(out);
            }
        }

        // Codes whose target the document cannot anchor still get an entry, stating why. A reference
        // that cannot resolve must say so rather than look clickable.
        const unresolvable = options.codes.entries.filter((entry) => (
            entry.status !== "live" || !entry.inDocument
        ));
        if (unresolvable.length > 0) {
            heading(out, 3, "Codes that no longer resolve", null);
            for (const entry of unresolvable) {
                push(out, `- \`${entry.code}\` — ${describeLocatorStatus(entry)}`);
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
