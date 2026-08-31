import { isModelDerivedNodeData } from "@/utils/edgeProvenance";
import { isNodeActive, nodeLabelOf, normalizeNodeLabel } from "@/pages/projectEditor/graphSemantics";
import { buildReportModel } from "./reportModel";
import { renderReportMarkdown } from "./reportMarkdown";
import { reportFileName } from "./reportFormat";
import { REPORT_FORMAT_VERSION, type ProjectReport, type ReportOptions, type ReportSnapshot } from "./reportTypes";

export { REPORT_FORMAT_VERSION };
export type { ProjectReport, ReportAbstract, ReportOptions, ReportSnapshot } from "./reportTypes";
export type { ReportModel } from "./reportModel";
export { buildReportModel, buildReportGraphContext } from "./reportModel";
export type { ReportGraphContext } from "./reportModel";
export { buildAbstractPayload, acceptAbstract } from "./reportAbstract";

/**
 * The whole report, from a snapshot. One call, no I/O, no clock, no randomness.
 *
 * The point of the seam is that the document is a **pure function of the project**: given the same
 * `ReportSnapshot` it produces the same bytes, so two exports can be diffed, a reader can check any
 * claim against the canvas, and the test can pin the whole thing without a browser. Everything
 * impure — reading the store, stamping the export instant, asking a model for an abstract, writing a
 * file — belongs to the caller.
 *
 * The abstract is passed in already validated, and never blocks: the deterministic document is
 * complete on its own, so a failed or refused abstract costs one italic line and nothing else.
 */
export function buildProjectReport(
    snapshot: ReportSnapshot,
    options: ReportOptions,
): ProjectReport {
    const model = buildReportModel(snapshot, options.codes);
    const markdown = renderReportMarkdown(model, options);

    const contentCards = model.allCards.filter((card) => card.label !== "person");
    const threads = model.phases.reduce((sum, phase) => sum + phase.threads.length, 0)
        + model.looseThreads.length;

    return {
        markdown,
        fileName: reportFileName(snapshot.projectTitle, snapshot.generatedAtIso),
        stats: {
            cards: contentCards.length,
            authoredCards: contentCards.filter((card) => card.authorship === "authored").length,
            modelProposedCards: contentCards.filter((card) => card.authorship === "model-proposed").length,
            relations: model.relations.length,
            phases: model.phases.length,
            threads,
            removedNodes: model.removedCards.length,
            setAsideCards: model.setAsideCards.length,
            codes: options.codes.entries.length,
        },
    };
}

/**
 * The card kinds the locator index should be built over, live only.
 *
 * Exported so the caller does not have to re-derive "which nodes count as content" and get a
 * different answer than the report did.
 */
export function liveContentCards(nodes: ReportSnapshot["nodes"]) {
    return nodes.filter((node) => {
        if (!isNodeActive(node)) return false;
        const label = normalizeNodeLabel(nodeLabelOf(node));
        return label !== "blueprint_group" && label !== "blueprint";
    });
}

/** Whether a node was proposed by a model, for callers that need the count before building a report. */
export function isModelProposed(node: ReportSnapshot["nodes"][number]): boolean {
    return isModelDerivedNodeData(node.data);
}
