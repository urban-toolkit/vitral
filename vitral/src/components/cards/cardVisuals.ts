import type { cardLabel, cardType } from "@/config/types";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
    faCalendar,
    faCube,
    faLightbulb,
    faLinesLeaning,
    faListCheck,
    faPerson,
} from "@fortawesome/free-solid-svg-icons";

export const CARD_LABELS: cardLabel[] = [
    "person",
    "activity",
    "requirement",
    "concept",
    "insight",
    "object",
];

export const CARD_LABEL_COLORS: Record<cardLabel, string> = {
    person: "rgba(231, 174, 255, 0.70)",
    activity: "rgba(174, 233, 255, 0.70)",
    object: "rgba(255, 243, 174, 0.70)",
    requirement: "rgba(255, 174, 174, 0.70)",
    concept: "rgba(224, 255, 174, 0.70)",
    insight: "rgba(174, 255, 198, 0.70)",
};

export const CARD_LABEL_ICONS: Record<cardLabel, IconDefinition> = {
    person: faPerson,
    activity: faCalendar,
    object: faCube,
    requirement: faListCheck,
    concept: faLinesLeaning,
    insight: faLightbulb,
};

/**
 * The colour family a label belongs to. `requirement` and `insight` are the committed side of a
 * study -- what it decided it needed and what it concluded -- and everything else is discursive.
 *
 * This is the one definition. It used to be copied into every site that minted or relabelled a
 * card, which is fine until the copies disagree: a card created as one label and a card
 * *relabelled* to it would render in different colours.
 */
export function cardTypeForLabel(label: string): cardType {
    return label === "requirement" || label === "insight" ? "technical" : "social";
}

export function normalizeCardLabel(label: string): cardLabel {
    const normalized = label.trim().toLowerCase();
    if (normalized === "task") return "requirement";
    if (normalized === "person") return "person";
    if (normalized === "activity") return "activity";
    if (normalized === "requirement") return "requirement";
    if (normalized === "concept") return "concept";
    if (normalized === "insight") return "insight";
    return "object";
}

