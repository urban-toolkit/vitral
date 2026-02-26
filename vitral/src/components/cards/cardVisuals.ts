import type { cardLabel } from "@/config/types";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
    faArrowPointer,
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
    "task",
];

export const CARD_LABEL_COLORS: Record<cardLabel, string> = {
    person: "rgba(231, 174, 255, 0.70)",
    activity: "rgb(174, 233, 255, 0.70)",
    object: "rgb(255, 243, 174, 0.70)",
    requirement: "rgb(255, 174, 174, 0.70)",
    concept: "rgb(224, 255, 174, 0.70)",
    insight: "rgb(174, 255, 198, 0.70)",
    task: "rgb(255, 174, 239, 0.70)",
};

export const CARD_LABEL_ICONS: Record<cardLabel, IconDefinition> = {
    person: faPerson,
    activity: faCalendar,
    object: faCube,
    requirement: faListCheck,
    concept: faLinesLeaning,
    insight: faLightbulb,
    task: faArrowPointer,
};

