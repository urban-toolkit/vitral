import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import classes from "./ClusterGlyph.module.css";
import { CARD_LABEL_COLORS, CARD_LABEL_ICONS, normalizeCardLabel } from "@/components/cards/cardVisuals";
import type { CanvasGlyphData } from "@/pages/projectEditor/canvasAbstraction";

/**
 * What a group of cards looks like when the canvas is abstracted.
 *
 * Everything it draws is precomputed by `buildAbstractedGraph` and handed over in
 * `data.canvasGlyph`, so this component holds no state and does no work beyond formatting. Colours
 * and icons come from `cardVisuals`, the same table the cards themselves use, so a glyph reads as
 * the same family as what it stands for.
 */

export type ClusterGlyphProps = {
    id?: string;
    data: {
        title?: string;
        canvasGlyph?: CanvasGlyphData;
    };
    onOpenCluster?: (glyph: CanvasGlyphData) => void;
    [key: string]: unknown;
};

const KIND_TEXT: Record<CanvasGlyphData["kind"], string> = {
    phase: "Phase",
    activity: "Activity",
    unassigned: "Unconnected",
};

function formatDateRange(startAt: string | null, endAt: string | null): string {
    const format = (value: string | null): string | null => {
        if (!value) return null;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };

    const start = format(startAt);
    const end = format(endAt);
    if (start && end && start !== end) return `${start} — ${end}`;
    return start ?? end ?? "";
}

function ClusterGlyphImpl(props: ClusterGlyphProps) {
    const glyph = props.data?.canvasGlyph;
    if (!glyph) return null;

    const accentLabel = glyph.kind === "phase" ? "activity" : normalizeCardLabel(
        glyph.labelCounts[0]?.label ?? "activity",
    );
    const accent = CARD_LABEL_COLORS[accentLabel];
    const dateRange = formatDateRange(glyph.startAt, glyph.endAt);

    const summary = glyph.kind === "phase"
        ? `${glyph.activityCount} ${glyph.activityCount === 1 ? "activity" : "activities"} · ${glyph.cardCount} cards`
        : `${glyph.cardCount} ${glyph.cardCount === 1 ? "card" : "cards"}`;

    const participants = glyph.participants ?? [];
    const participantsText = participants.join(", ");

    // The counts describe what is currently on the canvas, not the whole project — a glyph must
    // never promise more than expanding it would actually reveal.
    const tooltip = [
        glyph.label,
        summary,
        ...glyph.topTitles.map((title) => `• ${title}`),
        ...(participantsText !== "" ? [`Participants: ${participantsText}`] : []),
    ].join("\n");

    const canOpen = glyph.kind !== "unassigned";

    return (
        <div
            className={`${classes.glyph} ${glyph.kind === "phase" ? classes.phase : ""} ${glyph.kind === "unassigned" ? classes.unassigned : ""}`}
            style={{ borderColor: accent, cursor: canOpen ? "pointer" : "default" }}
            title={tooltip}
            onClick={() => {
                if (!canOpen) return;
                props.onOpenCluster?.(glyph);
            }}
        >
            <div className={classes.header}>
                <span className={classes.kindIcon} style={{ backgroundColor: accent }}>
                    <FontAwesomeIcon icon={CARD_LABEL_ICONS[accentLabel]} />
                </span>
                <span className={classes.kindText}>{KIND_TEXT[glyph.kind]}</span>
                <span className={classes.count}>{summary}</span>
            </div>

            <p className={classes.title}>{glyph.label}</p>
            {dateRange ? <p className={classes.dates}>{dateRange}</p> : null}

            {glyph.labelCounts.length > 0 ? (
                <div className={classes.composition}>
                    {glyph.labelCounts.map((entry) => (
                        <span key={entry.label} className={classes.compositionChip}>
                            <span
                                className={classes.compositionDot}
                                style={{ backgroundColor: CARD_LABEL_COLORS[normalizeCardLabel(entry.label)] }}
                            />
                            {entry.count}
                        </span>
                    ))}
                </div>
            ) : null}

            {glyph.kind === "phase" && glyph.topTitles.length > 0 ? (
                <ul className={classes.topList}>
                    {glyph.topTitles.map((title) => (
                        <li key={title} className={classes.topItem}>{title}</li>
                    ))}
                </ul>
            ) : null}

            {/* People are the one card kind a glyph never swallows silently: they are context for
                everything inside it, so they are listed by name here instead of competing with the
                work in the body above. */}
            <div className={classes.footer}>
                {participantsText !== "" ? (
                    <p className={classes.participants} title={`Participants: ${participantsText}`}>
                        <span className={classes.participantsLabel}>Participants:</span>
                        {" "}
                        {participantsText}
                    </p>
                ) : null}
                {canOpen ? <span className={classes.openHint}>Click to open</span> : null}
            </div>

            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

function areEqualGlyphProps(prev: ClusterGlyphProps, next: ClusterGlyphProps) {
    return (
        prev.id === next.id &&
        prev.data === next.data &&
        prev.onOpenCluster === next.onOpenCluster
    );
}

export const ClusterGlyph = memo(ClusterGlyphImpl, areEqualGlyphProps);
