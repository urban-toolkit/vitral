
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
    createDocument,
    loadDocument,
    loadDocuments,
    loadLiteratureSetupTemplates,
    saveDocument,
    updateDocumentMeta,
    type FlowStatePayload,
    type LiteratureSetupTemplate,
} from "@/api/stateApi";
import type { DesignStudyEvent, TimelineStatePayload } from "@/config/types";
import { requestGoalMilestonesLLM } from "@/func/LLMRequest";

import classes from "./ProjectSetupPage.module.css";

type Participant = {
    id: string;
    name: string;
    role: string;
};

type MilestoneInput = {
    id: string;
    name: string;
    occurredAt: string;
    generatedBy?: "manual" | "llm";
};

type StageInput = {
    id: string;
    name: string;
    start: string;
    end: string;
};

type SetupState = {
    projectName: string;
    goal: string;
    availableRoles: string[];
    participants: Participant[];
    timeline: {
        expectedStart: string;
        expectedEnd: string;
        milestones: MilestoneInput[];
        stages: StageInput[];
    };
};

type PreviousProjectOption = {
    id: string;
    title: string;
};

type TemplateSelection = {
    kind: "literature" | "previous";
    id: string;
} | null;
type JsonExportMode = "everything" | "configs";

type LiteratureTemplate = LiteratureSetupTemplate;

function toDateInputValue(date: Date): string {
    const tzOffset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 10);
}

function plusDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function safeIso(input: string, fallbackIso: string): string {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString();
}

function isPlaceholderStageName(name: string): boolean {
    return name.trim().toLowerCase() === "untitled";
}

function toDateInputFromUnknown(value: Date | string | undefined, fallback: string): string {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return toDateInputValue(parsed);
}

function buildInitialSetup(): SetupState {
    const today = new Date();
    const end = plusDays(today, 90);

    return {
        projectName: "Untitled",
        goal: "",
        availableRoles: ["Researcher", "Designer", "Developer"],
        participants: [
            {
                id: crypto.randomUUID(),
                name: "You",
                role: "Researcher",
            },
        ],
        timeline: {
            expectedStart: toDateInputValue(today),
            expectedEnd: toDateInputValue(end),
            milestones: [
                {
                    id: crypto.randomUUID(),
                    name: "Kickoff",
                    occurredAt: toDateInputValue(today),
                    generatedBy: "manual",
                },
            ],
            stages: [
                {
                    id: crypto.randomUUID(),
                    name: "Stage 1",
                    start: toDateInputValue(today),
                    end: toDateInputValue(plusDays(today, 14)),
                },
            ],
        },
    };
}

function normalizeSetup(source: unknown): SetupState {
    const initial = buildInitialSetup();
    if (!source || typeof source !== "object") return initial;

    const value = source as Partial<SetupState>;

    const availableRoles = Array.isArray(value.availableRoles)
        ? value.availableRoles.map((role) => String(role).trim()).filter(Boolean)
        : initial.availableRoles;

    const participants = Array.isArray(value.participants)
        ? value.participants.map((p) => ({
            id: String((p as Participant).id || crypto.randomUUID()),
            name: String((p as Participant).name || "Participant"),
            role: String((p as Participant).role || availableRoles[0] || "Researcher"),
        }))
        : initial.participants;

    const milestones: MilestoneInput[] = Array.isArray(value.timeline?.milestones)
        ? value.timeline.milestones.map((m): MilestoneInput => ({
            id: String((m as MilestoneInput).id || crypto.randomUUID()),
            name: String((m as MilestoneInput).name || "Milestone"),
            occurredAt: String((m as MilestoneInput).occurredAt || initial.timeline.expectedStart),
            generatedBy: (m as MilestoneInput).generatedBy === "llm" ? "llm" : "manual",
        }))
        : initial.timeline.milestones;

    const stages = Array.isArray(value.timeline?.stages)
        ? value.timeline.stages.map((s) => ({
            id: String((s as StageInput).id || crypto.randomUUID()),
            name: String((s as StageInput).name || "Stage"),
            start: String((s as StageInput).start || initial.timeline.expectedStart),
            end: String((s as StageInput).end || initial.timeline.expectedEnd),
        }))
        : initial.timeline.stages;

    return {
        projectName: String(value.projectName || initial.projectName),
        goal: String(value.goal || initial.goal),
        availableRoles: availableRoles.length > 0 ? availableRoles : initial.availableRoles,
        participants: participants.length > 0 ? participants : initial.participants,
        timeline: {
            expectedStart: String(value.timeline?.expectedStart || initial.timeline.expectedStart),
            expectedEnd: String(value.timeline?.expectedEnd || initial.timeline.expectedEnd),
            milestones,
            stages: stages.length > 0 ? stages : initial.timeline.stages,
        },
    };
}

function toTimelinePayload(
    setup: SetupState,
    existingTimeline?: TimelineStatePayload,
): TimelineStatePayload {
    const fallbackStartIso = new Date().toISOString();
    const fallbackEndIso = plusDays(new Date(), 90).toISOString();

    const stages = setup.timeline.stages.map((stage, index) => ({
        id: stage.id || crypto.randomUUID(),
        name: stage.name?.trim() || `Stage ${index + 1}`,
        start: safeIso(stage.start, fallbackStartIso),
        end: safeIso(stage.end, fallbackEndIso),
    }));

    const designStudyEvents: DesignStudyEvent[] = setup.timeline.milestones.map((milestone, index): DesignStudyEvent => ({
        id: milestone.id || crypto.randomUUID(),
        name: milestone.name?.trim() || `Milestone ${index + 1}`,
        occurredAt: safeIso(milestone.occurredAt, fallbackStartIso),
        generatedBy: milestone.generatedBy === "llm" ? "llm" : "manual",
    }));

    return {
        stages,
        subStages: Array.isArray(existingTimeline?.subStages) ? existingTimeline.subStages : [],
        designStudyEvents,
        blueprintEvents: Array.isArray(existingTimeline?.blueprintEvents) ? existingTimeline.blueprintEvents : [],
        codebaseSubtracks: Array.isArray(existingTimeline?.codebaseSubtracks) ? existingTimeline.codebaseSubtracks : [],
        knowledgeSubtracks: Array.isArray(existingTimeline?.knowledgeSubtracks) ? existingTimeline.knowledgeSubtracks : [],
        knowledgePillTrackAssignments:
            existingTimeline?.knowledgePillTrackAssignments &&
                typeof existingTimeline.knowledgePillTrackAssignments === "object"
                ? existingTimeline.knowledgePillTrackAssignments
                : {},
        blueprintCodebaseLinks: Array.isArray(existingTimeline?.blueprintCodebaseLinks)
            ? existingTimeline.blueprintCodebaseLinks
            : [],
        systemScreenshotMarkers: Array.isArray(existingTimeline?.systemScreenshotMarkers)
            ? existingTimeline.systemScreenshotMarkers
            : [],
        participants: setup.participants.map((participant, index) => ({
            id: participant.id || crypto.randomUUID(),
            name: participant.name?.trim() || `Participant ${index + 1}`,
            role: participant.role?.trim() || "Researcher",
        })),
        defaultStages: Array.from(
            new Set(
                stages
                    .map((stage) => stage.name)
                    .filter((name) => name.trim() !== "" && !isPlaceholderStageName(name))
            )
        ),
        timelineStartEnd: {
            start: safeIso(setup.timeline.expectedStart, fallbackStartIso),
            end: safeIso(setup.timeline.expectedEnd, fallbackEndIso),
        },
    };
}

function timelineToSetupParticipants(
    timeline: TimelineStatePayload | undefined,
): Participant[] {
    if (!Array.isArray(timeline?.participants) || timeline.participants.length === 0) {
        return [{ id: crypto.randomUUID(), name: "You", role: "Researcher" }];
    }

    return timeline.participants.map((participant, index) => ({
        id: participant.id || crypto.randomUUID(),
        name: participant.name || `Participant ${index + 1}`,
        role: participant.role || "Researcher",
    }));
}

function timelineToSetupTimeline(
    timeline: TimelineStatePayload | undefined,
    fallbackStart: string,
    fallbackEnd: string,
): SetupState["timeline"] {
    const expectedStart = toDateInputFromUnknown(timeline?.timelineStartEnd?.start, fallbackStart);
    const expectedEnd = toDateInputFromUnknown(timeline?.timelineStartEnd?.end, fallbackEnd);

    const milestones: MilestoneInput[] = Array.isArray(timeline?.designStudyEvents) && timeline.designStudyEvents.length > 0
        ? timeline.designStudyEvents.map((event, index): MilestoneInput => ({
            id: event.id || crypto.randomUUID(),
            name: event.name || `Milestone ${index + 1}`,
            occurredAt: toDateInputFromUnknown(event.occurredAt, expectedStart),
            generatedBy: event.generatedBy === "llm" ? "llm" : "manual",
        }))
        : [
            {
                id: crypto.randomUUID(),
                name: "Kickoff",
                occurredAt: expectedStart,
                generatedBy: "manual" as const,
            },
        ];

    const stages = Array.isArray(timeline?.stages) && timeline.stages.length > 0
        ? timeline.stages.map((stage, index) => ({
            id: stage.id || crypto.randomUUID(),
            name: stage.name || `Stage ${index + 1}`,
            start: toDateInputFromUnknown(stage.start, expectedStart),
            end: toDateInputFromUnknown(stage.end, expectedEnd),
        }))
        : [
            {
                id: crypto.randomUUID(),
                name: "Stage 1",
                start: expectedStart,
                end: expectedEnd,
            },
        ];

    return {
        expectedStart,
        expectedEnd,
        milestones,
        stages,
    };
}

function buildGoalMilestonesContext(setup: SetupState) {
    const fallbackStartIso = new Date().toISOString();
    const fallbackEndIso = plusDays(new Date(), 90).toISOString();

    return {
        projectName: setup.projectName.trim() || "Untitled",
        goal: setup.goal.trim(),
        expectedStart: safeIso(setup.timeline.expectedStart, fallbackStartIso),
        expectedEnd: safeIso(setup.timeline.expectedEnd, fallbackEndIso),
        availableRoles: setup.availableRoles.map((role) => role.trim()).filter(Boolean),
        participants: setup.participants.map((participant) => ({
            name: participant.name.trim() || "Participant",
            role: participant.role.trim() || "Researcher",
        })),
        stages: setup.timeline.stages.map((stage, index) => ({
            name: stage.name.trim() || `Stage ${index + 1}`,
            start: safeIso(stage.start, fallbackStartIso),
            end: safeIso(stage.end, fallbackEndIso),
        })),
        existingMilestones: setup.timeline.milestones.map((milestone, index) => ({
            name: milestone.name.trim() || `Milestone ${index + 1}`,
            occurredAt: safeIso(milestone.occurredAt, fallbackStartIso),
        })),
    };
}

function milestoneInputsFromEvents(events: DesignStudyEvent[], fallbackDate: string): MilestoneInput[] {
    return events.map((event, index): MilestoneInput => ({
        id: event.id || crypto.randomUUID(),
        name: event.name?.trim() || `Milestone ${index + 1}`,
        occurredAt: toDateInputFromUnknown(event.occurredAt, fallbackDate),
        generatedBy: event.generatedBy === "llm" ? "llm" : "manual",
    }));
}

function uniqueRoles(roles: string[]): string[] {
    return Array.from(new Set(roles.map((role) => role.trim()).filter(Boolean)));
}

export function ProjectSetupPage() {
    const { projectId } = useParams<{ projectId: string }>();
    const isEditMode = Boolean(projectId);
    const navigate = useNavigate();

    const [previousProjects, setPreviousProjects] = useState<PreviousProjectOption[]>([]);
    const [literatureTemplates, setLiteratureTemplates] = useState<LiteratureTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateSelection>(null);
    const [setup, setSetup] = useState<SetupState>(() => buildInitialSetup());
    const [existingFlowState, setExistingFlowState] = useState<FlowStatePayload>({ flow: { nodes: [], edges: [] } });
    const [existingTimelinePayload, setExistingTimelinePayload] = useState<TimelineStatePayload | undefined>(undefined);

    const [activeTab, setActiveTab] = useState<"form" | "json">("form");
    const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(buildInitialSetup(), null, 2));
    const [newRole, setNewRole] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [templateLoading, setTemplateLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadedGoal, setLoadedGoal] = useState("");
    const importInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let active = true;

        void (async () => {
            const errors: string[] = [];

            try {
                const docs = await loadDocuments();
                if (!active) return;

                const previous = docs
                    .filter((doc) => !projectId || doc.id !== projectId)
                    .sort((a, b) => {
                        const bTime = new Date(b.updated_at).getTime();
                        const aTime = new Date(a.updated_at).getTime();
                        return bTime - aTime;
                    })
                    .map((doc) => ({
                        id: doc.id,
                        title: doc.title?.trim() || "Untitled",
                    }));

                setPreviousProjects(previous);
            } catch {
                errors.push("Could not load previous projects.");
                if (active) setPreviousProjects([]);
            }

            try {
                const templates = await loadLiteratureSetupTemplates();
                if (!active) return;
                setLiteratureTemplates(templates);
            } catch {
                errors.push("Could not load literature templates.");
                if (active) setLiteratureTemplates([]);
            }

            if (isEditMode && projectId) {
                try {
                    const doc = await loadDocument(projectId);
                    if (!active) return;

                    const initial = buildInitialSetup();
                    const timeline = timelineToSetupTimeline(
                        doc.timeline,
                        initial.timeline.expectedStart,
                        initial.timeline.expectedEnd,
                    );
                    const participants = timelineToSetupParticipants(doc.timeline);
                    const availableRoles = uniqueRoles([
                        ...initial.availableRoles,
                        ...participants.map((participant) => participant.role),
                    ]);

                    setExistingFlowState(doc.state ?? { flow: { nodes: [], edges: [] } });
                    setExistingTimelinePayload(doc.timeline);
                    setLoadedGoal(doc.description || "");
                    setSetup((prev) => ({
                        ...prev,
                        projectName: doc.title || "Untitled",
                        goal: doc.description || "",
                        availableRoles: availableRoles.length > 0 ? availableRoles : initial.availableRoles,
                        participants,
                        timeline,
                    }));
                } catch {
                    errors.push("Could not load this project's current settings.");
                }
            }

            if (!active) return;
            setError(errors.length > 0 ? `${errors.join(" ")} You can still continue.` : null);
        })();

        return () => {
            active = false;
        };
    }, [isEditMode, projectId]);

    useEffect(() => {
        if (activeTab !== "form") return;
        setJsonDraft(JSON.stringify(setup, null, 2));
    }, [setup, activeTab]);

    const applyLiteratureTemplate = (template: LiteratureTemplate) => {
        setSelectedTemplate({ kind: "literature", id: template.id });
        setSetup((prev) => {
            const baseStart = toDateInputFromUnknown(prev.timeline.expectedStart, toDateInputValue(new Date()));
            const baseDate = new Date(baseStart);

            const milestones = (template.definition.timeline?.milestones ?? []).map((milestone) => ({
                id: crypto.randomUUID(),
                name: milestone.name,
                occurredAt: toDateInputValue(plusDays(baseDate, milestone.dayOffset ?? 0)),
                generatedBy: "manual" as const,
            }));

            const stages = (template.definition.timeline?.stages ?? []).map((stage) => ({
                id: crypto.randomUUID(),
                name: stage.name,
                start: toDateInputValue(plusDays(baseDate, stage.startDayOffset ?? 0)),
                end: toDateInputValue(plusDays(baseDate, stage.endDayOffset ?? 0)),
            }));

            const maxStageEnd = stages.reduce((max, stage) => {
                const parsed = new Date(stage.end).getTime();
                return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
            }, baseDate.getTime());

            const participants = (template.definition.participants ?? []).map((participant, index) => ({
                id: crypto.randomUUID(),
                name: participant.name || `Participant ${index + 1}`,
                role: participant.role || "Researcher",
            }));

            const roles = uniqueRoles([
                ...prev.availableRoles,
                ...participants.map((participant) => participant.role),
            ]);

            return {
                ...prev,
                availableRoles: roles.length > 0 ? roles : ["Researcher"],
                participants: participants.length > 0 ? participants : prev.participants,
                timeline: {
                    expectedStart: baseStart,
                    expectedEnd: toDateInputValue(new Date(maxStageEnd)),
                    milestones: milestones.length > 0 ? milestones : prev.timeline.milestones,
                    stages: stages.length > 0 ? stages : prev.timeline.stages,
                },
            };
        });
    };

    const applyPreviousProjectTemplate = async (option: PreviousProjectOption) => {
        setTemplateLoading(true);
        setError(null);

        try {
            const doc = await loadDocument(option.id);
            const initial = buildInitialSetup();
            const timeline = timelineToSetupTimeline(
                doc.timeline,
                initial.timeline.expectedStart,
                initial.timeline.expectedEnd,
            );

            setSelectedTemplate({ kind: "previous", id: option.id });
            setSetup((prev) => ({
                ...prev,
                availableRoles: uniqueRoles([...prev.availableRoles, "Researcher", "Designer"]),
                participants: [
                    { id: crypto.randomUUID(), name: "You", role: "Researcher" },
                    { id: crypto.randomUUID(), name: "Past Collaborator", role: "Designer" },
                ],
                timeline,
            }));
        } catch {
            setError("Could not apply previous project template.");
        } finally {
            setTemplateLoading(false);
        }
    };

    const applyJsonToForm = () => {
        try {
            const parsed = JSON.parse(jsonDraft);
            const normalized = normalizeSetup(parsed);
            setSetup(normalized);
            setError(null);
        } catch {
            setError("Invalid JSON. Please fix syntax and try again.");
        }
    };

    const buildExportPayload = (mode: JsonExportMode): unknown => {
        const source = activeTab === "json" ? JSON.parse(jsonDraft) : setup;
        const normalized = normalizeSetup(source);

        if (mode === "configs") {
            return {
                participants: normalized.participants,
                timeline: normalized.timeline,
            };
        }

        return normalized;
    };

    const triggerJsonImport = () => {
        importInputRef.current?.click();
    };

    const exportJson = (mode: JsonExportMode) => {
        try {
            const payload = buildExportPayload(mode);
            const content = JSON.stringify(payload, null, 2);
            const blob = new Blob([content], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const fileLabel = mode === "everything" ? "everything" : "configs";
            const safeProject = (setup.projectName.trim() || "project")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");

            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${safeProject || "project"}-${fileLabel}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setError(null);
        } catch {
            setError("Invalid JSON. Please fix syntax before exporting.");
        }
    };

    const onImportJsonFile = async (file: File | null) => {
        if (!file) return;
        try {
            const text = await file.text();
            const imported = JSON.parse(text) as unknown;
            if (!imported || typeof imported !== "object") {
                throw new Error("Invalid JSON");
            }

            let currentBase: SetupState;
            try {
                currentBase = normalizeSetup(JSON.parse(jsonDraft));
            } catch {
                currentBase = normalizeSetup(setup);
            }

            const source = imported as Partial<SetupState>;
            const next: SetupState = {
                ...currentBase,
                ...(Object.prototype.hasOwnProperty.call(source, "projectName")
                    ? { projectName: source.projectName as string }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(source, "goal")
                    ? { goal: source.goal as string }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(source, "availableRoles")
                    ? { availableRoles: source.availableRoles as string[] }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(source, "participants")
                    ? { participants: source.participants as Participant[] }
                    : {}),
            };

            if (Object.prototype.hasOwnProperty.call(source, "timeline") && source.timeline && typeof source.timeline === "object") {
                const timelineSource = source.timeline as Partial<SetupState["timeline"]>;
                next.timeline = {
                    ...currentBase.timeline,
                    ...(Object.prototype.hasOwnProperty.call(timelineSource, "expectedStart")
                        ? { expectedStart: timelineSource.expectedStart as string }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(timelineSource, "expectedEnd")
                        ? { expectedEnd: timelineSource.expectedEnd as string }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(timelineSource, "milestones")
                        ? { milestones: timelineSource.milestones as MilestoneInput[] }
                        : {}),
                    ...(Object.prototype.hasOwnProperty.call(timelineSource, "stages")
                        ? { stages: timelineSource.stages as StageInput[] }
                        : {}),
                };
            }

            const normalized = normalizeSetup(next);
            setSetup(normalized);
            setJsonDraft(JSON.stringify(normalized, null, 2));
            setError(null);
        } catch {
            setError("Invalid JSON file. Please select a valid JSON.");
        }
    };

    const onSubmitProjectSetup = async () => {
        setSubmitting(true);
        setError(null);

        let sourceSetup = setup;
        if (activeTab === "json") {
            try {
                sourceSetup = normalizeSetup(JSON.parse(jsonDraft));
                setSetup(sourceSetup);
            } catch {
                setError("Invalid JSON. Please fix syntax and try again.");
                setSubmitting(false);
                return;
            }
        }

        try {
            const title = sourceSetup.projectName.trim() || "Untitled";
            const goal = sourceSetup.goal.trim();
            const baselineGoal = loadedGoal.trim();
            const shouldGenerateGoalMilestones =
                goal.length > 0 && (!isEditMode || goal !== baselineGoal);

            let effectiveSetup = sourceSetup;
            if (shouldGenerateGoalMilestones) {
                const generatedMilestones = await requestGoalMilestonesLLM(
                    buildGoalMilestonesContext(sourceSetup)
                );

                if (generatedMilestones.length > 0) {
                    effectiveSetup = {
                        ...sourceSetup,
                        timeline: {
                            ...sourceSetup.timeline,
                            milestones: milestoneInputsFromEvents(
                                generatedMilestones,
                                sourceSetup.timeline.expectedStart
                            ),
                        },
                    };
                    setSetup(effectiveSetup);
                }
            }

            const timelinePayload = toTimelinePayload(
                effectiveSetup,
                isEditMode ? existingTimelinePayload : undefined,
            );

            if (isEditMode && projectId) {
                await saveDocument(projectId, existingFlowState, timelinePayload, title);
                await updateDocumentMeta(projectId, { description: goal || null });
                navigate(`/project/${projectId}`);
                return;
            }

            const created = await createDocument(title, { flow: { nodes: [], edges: [] } }, goal || undefined);
            await saveDocument(created.id, { flow: { nodes: [], edges: [] } }, timelinePayload, title);
            navigate(`/project/${created.id}`);
        } catch (err) {
            console.error(err);
            setError(isEditMode ? "Failed to update project." : "Failed to create project.");
        } finally {
            setSubmitting(false);
        }
    };

    const selectedTemplateLabel = selectedTemplate
        ? (selectedTemplate.kind === "literature"
            ? literatureTemplates.find((template) => template.id === selectedTemplate.id)?.name
            : previousProjects.find((project) => project.id === selectedTemplate.id)?.title)
        : null;

    return (
        <div className={classes.page}>
            <div className={classes.header}>
                <h1>{isEditMode ? "Project Settings" : "Project Setup"}</h1>
                <div className={classes.headerActions}>
                    <button
                        type="button"
                        onClick={() => navigate(isEditMode && projectId ? `/project/${projectId}` : "/projects")}
                    >
                        Cancel
                    </button>
                    <button type="button" onClick={onSubmitProjectSetup} disabled={submitting}>
                        {submitting ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save Changes" : "Create Project")}
                    </button>
                </div>
            </div>

            <div className={classes.tabs}>
                <button
                    type="button"
                    className={activeTab === "form" ? classes.tabActive : classes.tab}
                    onClick={() => setActiveTab("form")}
                >
                    Form
                </button>
                <button
                    type="button"
                    className={activeTab === "json" ? classes.tabActive : classes.tab}
                    onClick={() => {
                        setActiveTab("json");
                        setJsonDraft(JSON.stringify(setup, null, 2));
                    }}
                >
                    JSON
                </button>
            </div>

            {error ? <p className={classes.error}>{error}</p> : null}

            {activeTab === "json" ? (
                <div className={classes.jsonPanel}>
                    <div className={classes.jsonActions}>
                        <button type="button" onClick={triggerJsonImport}>
                            Import JSON
                        </button>
                        <button type="button" onClick={() => exportJson("everything")}>
                            Export JSON (Everything)
                        </button>
                        <button type="button" onClick={() => exportJson("configs")}>
                            Export JSON (Configs only)
                        </button>
                    </div>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            void onImportJsonFile(file);
                            event.target.value = "";
                        }}
                    />
                    <textarea
                        className={classes.jsonArea}
                        value={jsonDraft}
                        onChange={(event) => setJsonDraft(event.target.value)}
                    />
                    <button type="button" onClick={applyJsonToForm}>Apply JSON</button>
                </div>
            ) : (
                <div className={classes.form}>
                    <section className={classes.section}>
                        <h2>Project</h2>
                        <label>
                            Project name
                            <input
                                type="text"
                                value={setup.projectName}
                                onChange={(event) => setSetup((prev) => ({ ...prev, projectName: event.target.value }))}
                            />
                        </label>
                        <label>
                            Goal
                            <textarea
                                rows={3}
                                value={setup.goal}
                                onChange={(event) => setSetup((prev) => ({ ...prev, goal: event.target.value }))}
                            />
                        </label>
                    </section>

                    <section className={classes.section}>
                        <h2>Templates</h2>
                        <p className={classes.templateHint}>Select one template. It will auto-populate participants and timeline.</p>
                        {selectedTemplateLabel ? (
                            <p className={classes.templateHint}>Selected template: {selectedTemplateLabel}</p>
                        ) : null}
                        <div className={classes.templateGrid}>
                            <div className={classes.templateColumn}>
                                <h3>Literature</h3>
                                <div className={classes.pillWrap}>
                                    {literatureTemplates.map((template) => (
                                        <button
                                            key={template.id}
                                            type="button"
                                            className={
                                                selectedTemplate?.kind === "literature" && selectedTemplate.id === template.id
                                                    ? classes.pillActive
                                                    : classes.pill
                                            }
                                            onClick={() => applyLiteratureTemplate(template)}
                                        >
                                            {template.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className={classes.templateColumn}>
                                <h3>Previous Projects</h3>
                                <div className={classes.pillWrap}>
                                    {(previousProjects.length > 0 ? previousProjects : [{ id: "none", title: "No previous projects yet" }]).map((project) => (
                                        <button
                                            key={project.id}
                                            type="button"
                                            disabled={project.id === "none" || templateLoading}
                                            className={
                                                selectedTemplate?.kind === "previous" && selectedTemplate.id === project.id
                                                    ? classes.pillActive
                                                    : classes.pill
                                            }
                                            onClick={() => {
                                                if (project.id === "none") return;
                                                void applyPreviousProjectTemplate(project);
                                            }}
                                        >
                                            {project.title}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className={classes.section}>
                        <h2>Participants</h2>
                        <div className={classes.roleRow}>
                            <input
                                type="text"
                                placeholder="New role"
                                value={newRole}
                                onChange={(event) => setNewRole(event.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const role = newRole.trim();
                                    if (!role) return;
                                    setSetup((prev) => ({
                                        ...prev,
                                        availableRoles: prev.availableRoles.includes(role)
                                            ? prev.availableRoles
                                            : [...prev.availableRoles, role],
                                    }));
                                    setNewRole("");
                                }}
                            >
                                Add Role
                            </button>
                        </div>
                        {setup.participants.map((participant) => (
                            <div key={participant.id} className={classes.participantRow}>
                                <input
                                    type="text"
                                    value={participant.name}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        participants: prev.participants.map((item) => (
                                            item.id === participant.id ? { ...item, name: event.target.value } : item
                                        )),
                                    }))}
                                />
                                <select
                                    value={participant.role}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        participants: prev.participants.map((item) => (
                                            item.id === participant.id ? { ...item, role: event.target.value } : item
                                        )),
                                    }))}
                                >
                                    {setup.availableRoles.map((role) => (
                                        <option key={role} value={role}>{role}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => setSetup((prev) => ({
                                        ...prev,
                                        participants: prev.participants.filter((item) => item.id !== participant.id),
                                    }))}
                                    disabled={setup.participants.length <= 1}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setSetup((prev) => ({
                                ...prev,
                                participants: [
                                    ...prev.participants,
                                    {
                                        id: crypto.randomUUID(),
                                        name: `Participant ${prev.participants.length + 1}`,
                                        role: prev.availableRoles[0] || "Researcher",
                                    },
                                ],
                            }))}
                        >
                            Add Participant
                        </button>
                    </section>

                    <section className={classes.section}>
                        <h2>Timeline</h2>
                        <div className={classes.timelineRange}>
                            <label>
                                Expected start
                                <input
                                    type="date"
                                    value={setup.timeline.expectedStart}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: { ...prev.timeline, expectedStart: event.target.value },
                                    }))}
                                />
                            </label>
                            <label>
                                Expected end
                                <input
                                    type="date"
                                    value={setup.timeline.expectedEnd}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: { ...prev.timeline, expectedEnd: event.target.value },
                                    }))}
                                />
                            </label>
                        </div>

                        <h3>Milestones</h3>
                        {setup.timeline.milestones.map((milestone) => (
                            <div key={milestone.id} className={classes.timelineRow}>
                                <input
                                    type="text"
                                    value={milestone.name}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            milestones: prev.timeline.milestones.map((item) => (
                                                item.id === milestone.id ? { ...item, name: event.target.value } : item
                                            )),
                                        },
                                    }))}
                                />
                                <input
                                    type="date"
                                    value={milestone.occurredAt}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            milestones: prev.timeline.milestones.map((item) => (
                                                item.id === milestone.id ? { ...item, occurredAt: event.target.value } : item
                                            )),
                                        },
                                    }))}
                                />
                                <button
                                    type="button"
                                    onClick={() => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            milestones: prev.timeline.milestones.filter((item) => item.id !== milestone.id),
                                        },
                                    }))}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setSetup((prev) => ({
                                ...prev,
                                timeline: {
                                    ...prev.timeline,
                                    milestones: [
                                        ...prev.timeline.milestones,
                                        {
                                            id: crypto.randomUUID(),
                                            name: `Milestone ${prev.timeline.milestones.length + 1}`,
                                            occurredAt: prev.timeline.expectedStart,
                                            generatedBy: "manual",
                                        },
                                    ],
                                },
                            }))}
                        >
                            Add Milestone
                        </button>

                        <h3>Stages</h3>
                        <label>
                            Number of stages
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={setup.timeline.stages.length}
                                onChange={(event) => {
                                    const nextCount = Math.max(1, Math.min(20, Number(event.target.value) || 1));
                                    setSetup((prev) => {
                                        const stages = [...prev.timeline.stages];
                                        while (stages.length < nextCount) {
                                            const number = stages.length + 1;
                                            stages.push({
                                                id: crypto.randomUUID(),
                                                name: `Stage ${number}`,
                                                start: prev.timeline.expectedStart,
                                                end: prev.timeline.expectedEnd,
                                            });
                                        }
                                        while (stages.length > nextCount) {
                                            stages.pop();
                                        }
                                        return { ...prev, timeline: { ...prev.timeline, stages } };
                                    });
                                }}
                            />
                        </label>
                        {setup.timeline.stages.map((stage) => (
                            <div key={stage.id} className={classes.timelineRow}>
                                <input
                                    type="text"
                                    value={stage.name}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            stages: prev.timeline.stages.map((item) => (
                                                item.id === stage.id ? { ...item, name: event.target.value } : item
                                            )),
                                        },
                                    }))}
                                />
                                <input
                                    type="date"
                                    value={stage.start}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            stages: prev.timeline.stages.map((item) => (
                                                item.id === stage.id ? { ...item, start: event.target.value } : item
                                            )),
                                        },
                                    }))}
                                />
                                <input
                                    type="date"
                                    value={stage.end}
                                    onChange={(event) => setSetup((prev) => ({
                                        ...prev,
                                        timeline: {
                                            ...prev.timeline,
                                            stages: prev.timeline.stages.map((item) => (
                                                item.id === stage.id ? { ...item, end: event.target.value } : item
                                            )),
                                        },
                                    }))}
                                />
                            </div>
                        ))}
                    </section>
                </div>
            )}
        </div>
    );
}
