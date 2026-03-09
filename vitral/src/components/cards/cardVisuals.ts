import type { cardLabel } from "@/config/types";
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
    activity: "rgb(174, 233, 255, 0.70)",
    object: "rgb(255, 243, 174, 0.70)",
    requirement: "rgb(255, 174, 174, 0.70)",
    concept: "rgb(224, 255, 174, 0.70)",
    insight: "rgb(174, 255, 198, 0.70)",
};

export const CARD_LABEL_ICONS: Record<cardLabel, IconDefinition> = {
    person: faPerson,
    activity: faCalendar,
    object: faCube,
    requirement: faListCheck,
    concept: faLinesLeaning,
    insight: faLightbulb,
};

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

