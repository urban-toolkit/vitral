import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type {
	BlueprintEvent,
	DesignStudyEvent,
	GitHubEvent,
	SystemScreenshotMarker,
	Stage,
} from "@/config/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faCaretDown, faImages, faPlus, faWandSparkles } from "@fortawesome/free-solid-svg-icons";
import { StagePicker } from "@/components/timeline/StagePicker";
import { useDispatch, useSelector } from "react-redux";
import {
	addBlueprintCodebaseLink,
	addCodebaseSubtrack,
	addKnowledgeSubtrack,
	assignKnowledgePillToSubtrack,
	deleteBlueprintCodebaseLink,
	selectBlueprintCodebaseLinks,
	selectHighlightedCodebaseFilePaths,
	selectHoveredBlueprintComponentNodeId,
	addDesignStudyEvent,
	attachFileToCodebaseSubtrack,
	deleteCodebaseSubtrack,
	deleteKnowledgeSubtrack,
	deleteDesignStudyEvent,
	renameKnowledgeSubtrack,
	renameCodebaseSubtrack,
	selectCodebaseSubtracks,
	selectKnowledgePillTrackAssignments,
	selectKnowledgeSubtracks,
	selectHoveredCodebaseFilePath,
	selectAllSubStages,
	selectParticipants,
	selectSystemScreenshotMarkers,
	setHighlightedCodebaseFilePaths,
	setHighlightedKnowledgeNodeIds,
	toggleKnowledgeSubtrackCollapsed,
	toggleKnowledgeSubtrackInactive,
	toggleCodebaseSubtrackInactive,
	toggleCodebaseSubtrackCollapsed,
	updateDesignStudyEvent,
	updateSubStage,
	deleteSystemScreenshotMarker,
} from "@/store/timelineSlice";
import { MilestoneMenu } from "./MilestoneMenu";
import { requestCodebaseSubtrackFilesLLM, requestMilestonesLLM } from "@/func/LLMRequest";
import { CodebaseTooltip } from "./CodebaseTooltip";
import { BlueprintTooltip } from "./BlueprintTooltip";
import type {
	SelectedTimelineEvent,
	TimelineProps,
	KnowledgeBaseEvent,
} from "./timelineTypes";
import { formatDate, fromDate } from "./timelineUtils";
import { useParsedTimelineData } from "./useParsedTimelineData";
import { useTimelineChart } from "./useTimelineChart";

export type {
	BlueprintEvent,
	KnowledgeBaseEvent,
	KnowledgeBlueprintLink,
	KnowledgeCrossTreeConnection,
	KnowledgeTreePill,
	TimelineEventBase,
	TimelineProps,
} from "./timelineTypes";

type VisualEvolutionPanelState = {
	kind: "codebase" | "codebaseSubtrack";
	subtrackId?: string;
} | null;

type ScreenshotCropPreview = {
	markerId: string;
	occurredAt: string;
	imageDataUrl: string;
	imageWidth: number;
	imageHeight: number;
	cropX: number;
	cropY: number;
	cropWidth: number;
	cropHeight: number;
	scale: number;
	displayWidth: number;
	displayHeight: number;
};

const normalizeCodebasePath = (value: string) =>
	value.replace(/\\/g, "/").replace(/^\/+/, "").trim();

const toTimestamp = (value: string): number => {
	const parsed = new Date(value);
	const time = parsed.getTime();
	return Number.isNaN(time) ? 0 : time;
};

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

const VISUAL_EVOLUTION_EMPTY_TEXT = "Upload screenshots of your system to see its evolution here";

function buildSubtrackScreenshotCrops(
	markers: SystemScreenshotMarker[],
	filePaths: string[]
): ScreenshotCropPreview[] {
	const trackedPathSet = new Set(
		filePaths
			.filter((path): path is string => typeof path === "string")
			.map(normalizeCodebasePath)
			.filter(Boolean)
	);
	if (trackedPathSet.size === 0) return [];

	const previews: ScreenshotCropPreview[] = [];
	const previewMaxWidth = 220;
	const previewMaxHeight = 140;
	const cropPadding = 10;

	for (const marker of markers) {
		const imageDataUrl = String(marker.imageDataUrl ?? "").trim();
		const imageWidth = Number(marker.imageWidth ?? 0);
		const imageHeight = Number(marker.imageHeight ?? 0);
		if (!imageDataUrl || imageWidth <= 0 || imageHeight <= 0) continue;
		if (!Array.isArray(marker.zones) || marker.zones.length === 0) continue;

		const matchedZones = marker.zones.filter((zone) =>
			Array.isArray(zone.filePaths) &&
			zone.filePaths.some((path) => trackedPathSet.has(normalizeCodebasePath(path)))
		);
		if (matchedZones.length === 0) continue;

		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;

		for (const zone of matchedZones) {
			const zoneX = clamp(Number(zone.x ?? 0), 0, imageWidth);
			const zoneY = clamp(Number(zone.y ?? 0), 0, imageHeight);
			const zoneWidth = clamp(Number(zone.width ?? 0), 0, imageWidth - zoneX);
			const zoneHeight = clamp(Number(zone.height ?? 0), 0, imageHeight - zoneY);
			if (zoneWidth <= 0 || zoneHeight <= 0) continue;
			minX = Math.min(minX, zoneX);
			minY = Math.min(minY, zoneY);
			maxX = Math.max(maxX, zoneX + zoneWidth);
			maxY = Math.max(maxY, zoneY + zoneHeight);
		}

		if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
			continue;
		}

		const cropX = clamp(minX - cropPadding, 0, imageWidth);
		const cropY = clamp(minY - cropPadding, 0, imageHeight);
		const cropWidth = clamp((maxX - minX) + cropPadding * 2, 1, imageWidth - cropX);
		const cropHeight = clamp((maxY - minY) + cropPadding * 2, 1, imageHeight - cropY);

		const scale = Math.min(previewMaxWidth / cropWidth, previewMaxHeight / cropHeight);
		if (!Number.isFinite(scale) || scale <= 0) continue;

		previews.push({
			markerId: marker.id,
			occurredAt: marker.occurredAt,
			imageDataUrl,
			imageWidth,
			imageHeight,
			cropX,
			cropY,
			cropWidth,
			cropHeight,
			scale,
			displayWidth: Math.max(48, Math.round(cropWidth * scale)),
			displayHeight: Math.max(48, Math.round(cropHeight * scale)),
		});
	}

	return previews;
}

export const Timeline = ({
	projectId,
	readOnly = false,
	startMarker,
	endMarker,
	projectName,
	projectGoal,
	stages = [],
	codebaseEvents = [],
	knowledgeBaseEvents = [],
	designStudyEvents = [],
	blueprintEvents = [],
	knowledgeTreePills = [],
	knowledgeCrossTreeConnections = [],
	knowledgeBlueprintLinks = [],
	playbackAt = null,
	onPlaybackAtChange,
	connectedBlueprintComponentNodeIds = [],
	defaultStages = [],
	onStageUpdate,
	onStageCreation,
	onStageLaneCreation,
	onStageLaneDeletion,
	onStageBoundaryChange,
	onSyncCodebaseEvents,
	margin = { top: 22, right: 16, bottom: 34, left: 16 },
}: TimelineProps) => {
	const dispatch = useDispatch();

	const containerRef = useRef<HTMLDivElement | null>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const zoomTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

	const [width, setWidth] = useState(0);
	const [height, setHeight] = useState(0);

	const [selectedEvent, setSelectedEvent] = useState<SelectedTimelineEvent | null>(null);
	const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
	const [showTooltip, setShowTooltip] = useState(false);
	const [hoveredKnowledgeTreeId, setHoveredKnowledgeTreeId] = useState<string | null>(null);
	const [systemScreenshotTooltip, setSystemScreenshotTooltip] = useState<{
		markerId: string;
		x: number;
		y: number;
	} | null>(null);
	const [visualEvolutionPanel, setVisualEvolutionPanel] = useState<VisualEvolutionPanelState>(null);
	const [hoveredScreenshotZoneId, setHoveredScreenshotZoneId] = useState<string | null>(null);
	const [blueprintLinkMenu, setBlueprintLinkMenu] = useState<{
		x: number;
		y: number;
		blueprintEventId: string;
	} | null>(null);
	const [blueprintCodebaseLinkMenu, setBlueprintCodebaseLinkMenu] = useState<{
		x: number;
		y: number;
		linkId: string;
	} | null>(null);
	const [pendingBlueprintLinkEventId, setPendingBlueprintLinkEventId] = useState<string | null>(null);

	const [milestoneMenu, setMilestoneMenu] = useState<{
		x: number;
		y: number;
		date: string;
	} | null>(null);
	const [selectedMilestone, setSelectedMilestone] = useState<DesignStudyEvent | null>(null);

	const [tagPicker, setTagPicker] = useState<(Stage & { x: number; y: number }) | null>(null);

	const subStages = useSelector(selectAllSubStages);

	const [stageMenu, setStageMenu] = useState<{
		subStageId: string;
		x: number;
		y: number;
	} | null>(null);

	const [nameEdit, setNameEdit] = useState<{
		id: string;
		x: number;
		y: number;
		key: "designStudyEvent" | "subStage" | "codebaseSubtrack" | "knowledgeSubtrack";
		value: string;
	} | null>(null);

	const startCaretRef = useRef<HTMLSpanElement | null>(null);
	const endCaretRef = useRef<HTMLSpanElement | null>(null);
	const todayCaretRef = useRef<HTMLSpanElement | null>(null);
	const newStageButtonRef = useRef<HTMLSpanElement | null>(null);
	const newKnowledgeSubtrackButtonRef = useRef<HTMLSpanElement | null>(null);
	const newCodebaseSubtrackButtonRef = useRef<HTMLSpanElement | null>(null);
	const codebaseVisualButtonRef = useRef<HTMLSpanElement | null>(null);
	const syncCodebaseButtonRef = useRef<HTMLSpanElement | null>(null);
	const llmButtonRef = useRef<HTMLSpanElement | null>(null);
	const [isSyncingCodebase, setIsSyncingCodebase] = useState(false);
	const [isGeneratingMilestones, setIsGeneratingMilestones] = useState(false);
	const [suggestingCodebaseSubtrackIds, setSuggestingCodebaseSubtrackIds] = useState<string[]>([]);

	const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
	const knowledgeSubtracks = useSelector(selectKnowledgeSubtracks);
	const knowledgePillTrackAssignments = useSelector(selectKnowledgePillTrackAssignments);
	const participants = useSelector(selectParticipants);
	const systemScreenshotMarkers = useSelector(selectSystemScreenshotMarkers);
	const highlightedCodebaseFilePaths = useSelector(selectHighlightedCodebaseFilePaths);
	const blueprintCodebaseLinks = useSelector(selectBlueprintCodebaseLinks);
	const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);
	const hoveredBlueprintComponentNodeId = useSelector(selectHoveredBlueprintComponentNodeId);

	const systemScreenshotTooltipMarker = useMemo(
		() => systemScreenshotTooltip
			? (systemScreenshotMarkers.find((marker) => marker.id === systemScreenshotTooltip.markerId) ?? null)
			: null,
		[systemScreenshotMarkers, systemScreenshotTooltip]
	);

	const hoveredScreenshotZone = useMemo(
		() => systemScreenshotTooltipMarker?.zones?.find((zone) => zone.id === hoveredScreenshotZoneId) ?? null,
		[hoveredScreenshotZoneId, systemScreenshotTooltipMarker]
	);
	const orderedScreenshotMarkers = useMemo(
		() => [...systemScreenshotMarkers].sort((a, b) => toTimestamp(a.occurredAt) - toTimestamp(b.occurredAt)),
		[systemScreenshotMarkers]
	);
	const codebaseVisualScreenshots = useMemo(
		() => orderedScreenshotMarkers.filter((marker) => String(marker.imageDataUrl ?? "").trim() !== ""),
		[orderedScreenshotMarkers]
	);
	const visualEvolutionSubtrack = useMemo(() => {
		if (!visualEvolutionPanel || visualEvolutionPanel.kind !== "codebaseSubtrack") return null;
		const subtrackId = visualEvolutionPanel.subtrackId;
		if (!subtrackId) return null;
		return codebaseSubtracks.find((subtrack) => subtrack.id === subtrackId) ?? null;
	}, [codebaseSubtracks, visualEvolutionPanel]);
	const visualEvolutionSubtrackCrops = useMemo(() => {
		if (!visualEvolutionSubtrack) return [];
		return buildSubtrackScreenshotCrops(
			orderedScreenshotMarkers,
			Array.isArray(visualEvolutionSubtrack.filePaths) ? visualEvolutionSubtrack.filePaths : []
		);
	}, [orderedScreenshotMarkers, visualEvolutionSubtrack]);

	useEffect(() => {
		if (!visualEvolutionPanel) return;
		if (visualEvolutionPanel.kind !== "codebaseSubtrack") return;
		if (visualEvolutionSubtrack) return;
		setVisualEvolutionPanel(null);
	}, [visualEvolutionSubtrack, visualEvolutionPanel]);

	const knowledgeTreeNodeIdsByTreeId = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const pill of knowledgeTreePills) {
			const nodeIds = Array.isArray(pill.events)
				? Array.from(new Set(
					pill.events
						.map((eventData) => eventData.nodeId)
						.filter((nodeId): nodeId is string => typeof nodeId === "string" && nodeId.trim() !== "")
				))
				: [];
			map.set(pill.treeId, nodeIds);
		}
		return map;
	}, [knowledgeTreePills]);

	useEffect(() => {
		if (!hoveredKnowledgeTreeId) {
			dispatch(setHighlightedKnowledgeNodeIds([]));
			return;
		}
		const nodeIds = knowledgeTreeNodeIdsByTreeId.get(hoveredKnowledgeTreeId) ?? [];
		dispatch(setHighlightedKnowledgeNodeIds(nodeIds));
	}, [dispatch, hoveredKnowledgeTreeId, knowledgeTreeNodeIdsByTreeId]);

	useEffect(() => {
		if (!containerRef.current) return;
		const resizeTarget = containerRef.current.parentElement ?? containerRef.current;

		const resizeObserver = new ResizeObserver(([entry]) => {
			setWidth(Math.floor(entry.contentRect.width));
			setHeight(Math.floor(entry.contentRect.height));
		});

		resizeObserver.observe(resizeTarget);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setBlueprintLinkMenu(null);
			setBlueprintCodebaseLinkMenu(null);
			setPendingBlueprintLinkEventId(null);
			setHoveredKnowledgeTreeId(null);
			setSystemScreenshotTooltip(null);
			setVisualEvolutionPanel(null);
			setHoveredScreenshotZoneId(null);
			dispatch(setHighlightedCodebaseFilePaths([]));
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [dispatch]);

	useEffect(() => {
		if (!systemScreenshotTooltipMarker) {
			if (hoveredScreenshotZoneId !== null) {
				setHoveredScreenshotZoneId(null);
			}
			return;
		}

		if (
			hoveredScreenshotZoneId &&
			!systemScreenshotTooltipMarker.zones?.some((zone) => zone.id === hoveredScreenshotZoneId)
		) {
			setHoveredScreenshotZoneId(null);
		}
	}, [hoveredScreenshotZoneId, systemScreenshotTooltipMarker]);

	useEffect(() => {
		const nextPaths = hoveredScreenshotZone?.filePaths ?? [];
		const same =
			nextPaths.length === highlightedCodebaseFilePaths.length &&
			nextPaths.every((path, index) => path === highlightedCodebaseFilePaths[index]);
		if (same) return;
		dispatch(setHighlightedCodebaseFilePaths(nextPaths));
	}, [dispatch, highlightedCodebaseFilePaths, hoveredScreenshotZone]);

	useEffect(() => {
		return () => {
			dispatch(setHighlightedCodebaseFilePaths([]));
			dispatch(setHighlightedKnowledgeNodeIds([]));
		};
	}, [dispatch]);

	const parsed = useParsedTimelineData({
		startMarker,
		endMarker,
		stages,
		subStages,
		codebaseEvents,
		knowledgeBaseEvents,
		designStudyEvents,
		blueprintEvents,
	});

	useTimelineChart({
		containerRef,
		svgRef,
		zoomTransformRef,
		startCaretRef,
		endCaretRef,
		todayCaretRef,
		newStageButtonRef,
		newKnowledgeSubtrackButtonRef,
		newCodebaseSubtrackButtonRef,
		codebaseVisualButtonRef,
		syncCodebaseButtonRef,
		llmButtonRef,
		width,
		height,
		margin,
		defaultStages,
		parsed,
		codebaseSubtracks,
		knowledgeSubtracks,
		knowledgePillTrackAssignments,
		knowledgeTreePills,
		knowledgeCrossTreeConnections,
		knowledgeBlueprintLinks,
		hoveredKnowledgeTreeId,
		onHoveredKnowledgeTreeIdChange: setHoveredKnowledgeTreeId,
		blueprintCodebaseLinks,
		systemScreenshotMarkers,
		playbackAt,
		onPlaybackAtChange,
		pendingBlueprintLinkEventId,
		hoveredCodebaseFilePath,
		highlightedCodebaseFilePaths,
		hoveredBlueprintComponentNodeId,
		connectedBlueprintComponentNodeIds,
		readOnly,
		dispatch,
		onStageBoundaryChange,
		onStageLaneDeletion,
		onAttachFileToCodebaseSubtrack: (subtrackId, filePath) => {
			if (readOnly) return;
			dispatch(attachFileToCodebaseSubtrack({ subtrackId, filePath }));
		},
		onToggleCodebaseSubtrackCollapsed: (subtrackId) => {
			if (readOnly) return;
			dispatch(toggleCodebaseSubtrackCollapsed(subtrackId));
		},
		onToggleCodebaseSubtrackInactive: (subtrackId) => {
			if (readOnly) return;
			dispatch(toggleCodebaseSubtrackInactive(subtrackId));
		},
		onToggleKnowledgeSubtrackCollapsed: (subtrackId) => {
			if (readOnly) return;
			dispatch(toggleKnowledgeSubtrackCollapsed(subtrackId));
		},
		onToggleKnowledgeSubtrackInactive: (subtrackId) => {
			if (readOnly) return;
			dispatch(toggleKnowledgeSubtrackInactive(subtrackId));
		},
		onDeleteCodebaseSubtrack: (subtrackId) => {
			if (readOnly) return;
			dispatch(deleteCodebaseSubtrack(subtrackId));
		},
		onDeleteKnowledgeSubtrack: (subtrackId) => {
			if (readOnly) return;
			dispatch(deleteKnowledgeSubtrack(subtrackId));
		},
		onAssignKnowledgePillToSubtrack: (treeId, subtrackId) => {
			if (readOnly) return;
			dispatch(assignKnowledgePillToSubtrack({ treeId, subtrackId }));
		},
		onCreateBlueprintCodebaseLink: (blueprintEventId, codebaseSubtrackId) => {
			if (readOnly) return;
			dispatch(addBlueprintCodebaseLink({ blueprintEventId, codebaseSubtrackId, origin: "manual" }));
			setPendingBlueprintLinkEventId(null);
		},
		onDeleteSystemScreenshotMarker: (markerId) => {
			if (readOnly) return;
			dispatch(deleteSystemScreenshotMarker(markerId));
			setSystemScreenshotTooltip((previous) =>
				previous?.markerId === markerId ? null : previous
			);
			setHoveredScreenshotZoneId(null);
			dispatch(setHighlightedCodebaseFilePaths([]));
		},
		onSuggestCodebaseSubtrackFiles: (subtrackId) => {
			if (readOnly) return;
			void handleSuggestCodebaseSubtrackFiles(subtrackId);
		},
		onToggleCodebaseSubtrackVisualEvolution: (subtrackId) => {
			setVisualEvolutionPanel((previous) => {
				if (
					previous?.kind === "codebaseSubtrack" &&
					previous.subtrackId === subtrackId
				) {
					return null;
				}
				return {
					kind: "codebaseSubtrack",
					subtrackId,
				};
			});
			setSystemScreenshotTooltip(null);
			setHoveredScreenshotZoneId(null);
		},
		suggestingCodebaseSubtrackIds,
		setSystemScreenshotTooltip,
		setMilestoneMenu,
		setSelectedMilestone,
		setBlueprintLinkMenu,
		setBlueprintCodebaseLinkMenu,
		setTagPicker,
		setStageMenu,
		setNameEdit,
		setSelectedEvent,
		setTooltipPosition,
		setShowTooltip,
	});

	const updateSubStageStage = (subStageId: string, newStage: string) => {
		if (readOnly) return;
		const matchingSubStages = parsed.subStages.filter((subStage) => subStage.id == subStageId);

		if (matchingSubStages.length <= 0) return;

		const subStageToUpdate = matchingSubStages[0];

		dispatch(
			updateSubStage({
				...subStageToUpdate,
				start: fromDate(subStageToUpdate.start),
				end: fromDate(subStageToUpdate.end),
				stage: newStage,
			})
		);
	};

	const commitNameEdit = () => {
		if (!nameEdit) return;
		if (readOnly) {
			setNameEdit(null);
			return;
		}

		const nextName = nameEdit.value.trim();

		if (nameEdit.key === "subStage") {
			const matchingSubStages = parsed.subStages.filter((subStage) => subStage.id == nameEdit.id);

			if (matchingSubStages.length <= 0) return;

			const subStageToUpdate = matchingSubStages[0];

			dispatch(
				updateSubStage({
					...subStageToUpdate,
					start: fromDate(subStageToUpdate.start),
					end: fromDate(subStageToUpdate.end),
					name: nextName,
				})
			);
		}

		if (nameEdit.key === "designStudyEvent") {
			const matchingDesignStudyEvents = parsed.ds.filter(
				(designStudyEvent) => designStudyEvent.id == nameEdit.id
			);

			if (matchingDesignStudyEvents.length <= 0) return;

			const eventToUpdate = matchingDesignStudyEvents[0];

			dispatch(
				updateDesignStudyEvent({
					...eventToUpdate,
					occurredAt: fromDate(eventToUpdate.date),
					name: nextName,
				})
			);
		}

		if (nameEdit.key === "codebaseSubtrack") {
			dispatch(
				renameCodebaseSubtrack({
					subtrackId: nameEdit.id,
					name: nextName,
				})
			);
		}

		if (nameEdit.key === "knowledgeSubtrack") {
			dispatch(
				renameKnowledgeSubtrack({
					subtrackId: nameEdit.id,
					name: nextName,
				})
			);
		}

		setNameEdit(null);
	};

	const handleGenerateMilestones = async () => {
		if (readOnly) return;
		if (isGeneratingMilestones) return;
		setIsGeneratingMilestones(true);
		document.body.style.cursor = "wait";
		try {
			const toIso = (value: unknown, fallbackIso: string): string => {
				const parsed = new Date(String(value ?? ""));
				if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
				return fallbackIso;
			};

			const fallbackStartIso = toIso(startMarker, new Date().toISOString());
			const fallbackEndIso = toIso(endMarker, fallbackStartIso);

			const milestones = await requestMilestonesLLM({
				projectName: (projectName ?? "").trim() || "Untitled",
				goal: (projectGoal ?? "").trim(),
				expectedStart: fallbackStartIso,
				expectedEnd: fallbackEndIso,
				availableRoles: Array.from(new Set(
					participants
						.map((participant) => String(participant.role ?? "").trim())
						.filter(Boolean)
				)),
				participants: participants.map((participant) => ({
					name: String(participant.name ?? "").trim() || "Participant",
					role: String(participant.role ?? "").trim() || "Researcher",
				})),
				stages: parsed.stages.map((stage, index) => ({
					name: String(stage.name ?? "").trim() || `Stage ${index + 1}`,
					start: toIso(stage.start, fallbackStartIso),
					end: toIso(stage.end, fallbackEndIso),
				})),
				existingMilestones: parsed.ds.map((designStudyEvent) => ({
					id: designStudyEvent.id,
					name: designStudyEvent.name,
					occurredAt: fromDate(designStudyEvent.occurredAt),
				})),
			});

			console.log("milestones", milestones);

			for (const milestone of milestones) {
				dispatch(addDesignStudyEvent({ ...milestone, generatedBy: "llm" }));
			}
		} finally {
			document.body.style.cursor = "default";
			setIsGeneratingMilestones(false);
		}
	};

	const handleSuggestCodebaseSubtrackFiles = async (subtrackId: string) => {
		if (readOnly) return;
		if (suggestingCodebaseSubtrackIds.includes(subtrackId)) return;

		const subtrack = codebaseSubtracks.find((entry) => entry.id === subtrackId);
		if (!subtrack) return;

		setSuggestingCodebaseSubtrackIds((prev) => {
			if (prev.includes(subtrackId)) return prev;
			return [...prev, subtrackId];
		});

		try {
			const suggestedFilePaths = await requestCodebaseSubtrackFilesLLM({
				projectId,
				projectTitle: (projectName ?? "").trim() || "Untitled",
				projectGoal: (projectGoal ?? "").trim(),
				codebaseSubtrackTitle: (subtrack.name ?? "").trim() || "Codebase subtrack",
				existingFilePaths: Array.isArray(subtrack.filePaths) ? subtrack.filePaths : [],
			});

			for (const filePath of suggestedFilePaths) {
				dispatch(attachFileToCodebaseSubtrack({ subtrackId, filePath }));
			}
		} finally {
			setSuggestingCodebaseSubtrackIds((prev) => prev.filter((id) => id !== subtrackId));
		}
	};

	const visualEvolutionFloatingStyle = useMemo(() => {
		if (!visualEvolutionPanel || !containerRef.current || typeof window === "undefined") {
			return null;
		}

		const rect = containerRef.current.getBoundingClientRect();
		const widthPx = Math.max(280, rect.width - 20);
		const maxWidth = window.innerWidth - 24;
		const resolvedWidth = Math.min(widthPx, maxWidth);
		const left = Math.max(
			12,
			Math.min(rect.left + (rect.width - resolvedWidth) / 2, window.innerWidth - resolvedWidth - 12)
		);
		const bottom = Math.max(8, window.innerHeight - rect.top + 8);

		return {
			left,
			bottom,
			width: resolvedWidth,
		};
	}, [visualEvolutionPanel, width, height]);

	const tooltipInner = useMemo(() => {
		if (selectedEvent?.kind === "codebase") {
			return <CodebaseTooltip event={selectedEvent.event as GitHubEvent} />;
		}
		if (selectedEvent?.kind === "blueprint") {
			return <BlueprintTooltip event={selectedEvent.event as BlueprintEvent} />;
		}
		if (selectedEvent?.kind === "knowledge") {
			const event = selectedEvent.event as KnowledgeBaseEvent;
			return (
				<div className={classes.codeBaseTooltip}>
					<div className={classes.tooltipHeader}>
						<p style={{ fontWeight: "bold", fontSize: "var(--font-size-md)" }}>
							{event.label || "Knowledge event"}
						</p>
					</div>
					<p style={{ fontSize: "var(--font-size-xs)", color: "var(--subtitle-color)" }}>
						{event.occurredAt ? new Date(event.occurredAt).toLocaleString() : ""}
					</p>
					{event.description ? (
						<p style={{ fontSize: "var(--font-size-sm)", whiteSpace: "pre-wrap" }}>
							{event.description}
						</p>
					) : null}
				</div>
			);
		}

		return null;
	}, [selectedEvent]);

	return (
		<>
			<div
				id="timelineContainer"
				ref={containerRef}
				className={classes.container}
				onClick={() => {
					setShowTooltip(false);
					setMilestoneMenu(null);
					setBlueprintLinkMenu(null);
					setBlueprintCodebaseLinkMenu(null);
					setHoveredKnowledgeTreeId(null);
					setSystemScreenshotTooltip(null);
					setVisualEvolutionPanel(null);
					setHoveredScreenshotZoneId(null);
					dispatch(setHighlightedCodebaseFilePaths([]));
				}}
			>
				<svg ref={svgRef} className={classes.svg} />

					<span ref={startCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
						<FontAwesomeIcon icon={faCaretDown} />
					</span>

					<span ref={endCaretRef} className={classes.marker} style={{ left: 0, top: margin.top }}>
						<FontAwesomeIcon icon={faCaretDown} />
					</span>

					<span
						ref={todayCaretRef}
						className={classes.marker}
						style={{ left: 0, top: margin.top, display: "none" }}
					>
						<FontAwesomeIcon icon={faCaretDown} />
					</span>

					<span
						ref={newStageButtonRef}
						className={classes.newStage}
						style={readOnly ? { display: "none" } : undefined}
						onClick={() => {
							if (readOnly) return;
							onStageLaneCreation("Untitled");
						}}
					>
						<FontAwesomeIcon icon={faPlus} />
					</span>

					<span
						ref={newKnowledgeSubtrackButtonRef}
						className={classes.newStage}
						style={readOnly ? { display: "none" } : undefined}
						title="Add knowledge subtrack"
						onClick={() => {
							if (readOnly) return;
							dispatch(
								addKnowledgeSubtrack({
									id: crypto.randomUUID(),
									name: `Knowledge subtrack ${knowledgeSubtracks.length + 1}`,
									filePaths: [],
									collapsed: false,
									inactive: false,
								})
							);
						}}
					>
						<FontAwesomeIcon icon={faPlus} />
					</span>

					<span
						ref={newCodebaseSubtrackButtonRef}
						className={classes.newStage}
						style={readOnly ? { display: "none" } : undefined}
						title="Add codebase subtrack"
						onClick={() => {
							if (readOnly) return;
							dispatch(
								addCodebaseSubtrack({
									id: crypto.randomUUID(),
									name: `Codebase subtrack ${codebaseSubtracks.length + 1}`,
									filePaths: [],
									collapsed: false,
									inactive: false,
								})
							);
						}}
					>
						<FontAwesomeIcon icon={faPlus} />
					</span>

					<span
						ref={codebaseVisualButtonRef}
						className={classes.newStage}
						title="Show codebase visual evolution"
						onClick={(event) => {
							event.stopPropagation();
							setVisualEvolutionPanel((previous) =>
								previous?.kind === "codebase"
									? null
									: { kind: "codebase" }
							);
							setSystemScreenshotTooltip(null);
							setHoveredScreenshotZoneId(null);
						}}
					>
						<FontAwesomeIcon icon={faImages} />
					</span>

					<span
						ref={syncCodebaseButtonRef}
						className={classes.newStage}
						style={readOnly ? { display: "none" } : undefined}
						title="Sync codebase commits"
						onClick={async (event) => {
							event.stopPropagation();
							if (readOnly) return;
							if (!onSyncCodebaseEvents || isSyncingCodebase) return;
							setIsSyncingCodebase(true);
							try {
								await onSyncCodebaseEvents();
							} finally {
								setIsSyncingCodebase(false);
							}
						}}
					>
						<FontAwesomeIcon icon={faArrowsRotate} spin={isSyncingCodebase} />
					</span>

					<span
						ref={llmButtonRef}
						className={classes.newStage}
						style={{
							...(readOnly ? { display: "none" } : {}),
							color: isGeneratingMilestones ? "#9b9b9b" : undefined,
							opacity: isGeneratingMilestones ? 0.5 : 1,
							cursor: isGeneratingMilestones ? "wait" : "pointer",
						}}
						onClick={handleGenerateMilestones}
					>
						<FontAwesomeIcon icon={faWandSparkles} />
					</span>

					{pendingBlueprintLinkEventId && !readOnly && (
						<div
							className={classes.linkModeHint}
							onClick={(event) => event.stopPropagation()}
						>
							<span>Create link mode: click a codebase subtrack row.</span>
							<button
								type="button"
								className={classes.linkModeButton}
								onClick={() => setPendingBlueprintLinkEventId(null)}
							>
								Cancel
							</button>
						</div>
					)}

					{blueprintLinkMenu && !readOnly && (
						<div
							className={classes.timelineContextMenu}
							style={{ left: blueprintLinkMenu.x, top: blueprintLinkMenu.y }}
							onClick={(event) => event.stopPropagation()}
						>
							<button
								type="button"
								className={classes.timelineContextMenuButton}
								onClick={() => {
									setPendingBlueprintLinkEventId(blueprintLinkMenu.blueprintEventId);
									setBlueprintLinkMenu(null);
									setShowTooltip(false);
								}}
							>
								Create link
							</button>
						</div>
					)}

				{blueprintCodebaseLinkMenu && !readOnly && (
					<div
						className={classes.timelineContextMenu}
						style={{ left: blueprintCodebaseLinkMenu.x, top: blueprintCodebaseLinkMenu.y }}
						onClick={(event) => event.stopPropagation()}
					>
						<button
							type="button"
							className={classes.timelineContextMenuButton}
							onClick={() => {
								dispatch(deleteBlueprintCodebaseLink(blueprintCodebaseLinkMenu.linkId));
								setBlueprintCodebaseLinkMenu(null);
								setShowTooltip(false);
							}}
						>
							Delete link
						</button>
					</div>
				)}
			</div>

			<div
				className={classes.tooltip}
				style={{
					left: tooltipPosition.x,
					top: tooltipPosition.y,
					pointerEvents: "none",
					...(showTooltip ? { display: "block" } : { display: "none" }),
				}}
			>
				{tooltipInner}
			</div>

			{systemScreenshotTooltip && systemScreenshotTooltipMarker && typeof document !== "undefined"
				? createPortal((
					<div
						className={classes.screenshotTooltip}
						style={{ left: systemScreenshotTooltip.x, top: systemScreenshotTooltip.y }}
						onClick={(event) => event.stopPropagation()}
						onMouseLeave={() => setHoveredScreenshotZoneId(null)}
					>
						{systemScreenshotTooltipMarker.imageDataUrl ? (
							<div
								className={classes.screenshotTooltipMedia}
								style={
									systemScreenshotTooltipMarker.imageWidth && systemScreenshotTooltipMarker.imageHeight
										? { aspectRatio: `${systemScreenshotTooltipMarker.imageWidth} / ${systemScreenshotTooltipMarker.imageHeight}` }
										: undefined
								}
							>
								<img
									src={systemScreenshotTooltipMarker.imageDataUrl}
									alt="System screenshot"
									className={classes.screenshotTooltipImage}
								/>
								{Array.isArray(systemScreenshotTooltipMarker.zones) &&
									systemScreenshotTooltipMarker.zones.length > 0 &&
									systemScreenshotTooltipMarker.imageWidth &&
									systemScreenshotTooltipMarker.imageHeight ? (
									<div className={classes.screenshotZonesLayer}>
										{systemScreenshotTooltipMarker.zones.map((zone) => {
											const left = Math.max(
												0,
												Math.min(100, (zone.x / systemScreenshotTooltipMarker.imageWidth!) * 100)
											);
											const top = Math.max(
												0,
												Math.min(100, (zone.y / systemScreenshotTooltipMarker.imageHeight!) * 100)
											);
											const widthPercent = Math.max(
												0.8,
												Math.min(100 - left, (zone.width / systemScreenshotTooltipMarker.imageWidth!) * 100)
											);
											const heightPercent = Math.max(
												0.8,
												Math.min(100 - top, (zone.height / systemScreenshotTooltipMarker.imageHeight!) * 100)
											);
											const filesTooltip = zone.filePaths.length > 0
												? zone.filePaths.join("\n")
												: "No linked files";
											return (
												<button
													key={zone.id}
													type="button"
													className={`${classes.screenshotZoneRect} ${hoveredScreenshotZoneId === zone.id ? classes.screenshotZoneRectActive : ""
														}`}
													style={{
														left: `${left}%`,
														top: `${top}%`,
														width: `${widthPercent}%`,
														height: `${heightPercent}%`,
													}}
													title={filesTooltip}
													onMouseEnter={() => setHoveredScreenshotZoneId(zone.id)}
													onMouseLeave={() =>
														setHoveredScreenshotZoneId((current) =>
															current === zone.id ? null : current
														)
													}
													onClick={(event) => event.stopPropagation()}
												/>
											);
										})}
									</div>
								) : null}
							</div>
						) : (
							<p className={classes.screenshotTooltipEmpty}>No screenshot uploaded</p>
						)}
						{hoveredScreenshotZone ? (
							<p className={classes.screenshotTooltipHint}>
								{hoveredScreenshotZone.name}
							</p>
						) : (
							<p className={classes.screenshotTooltipHint}>
								Hover a zone to highlight matching files and subtracks.
							</p>
						)}
					</div>
				), document.body)
				: null}

			{visualEvolutionPanel && visualEvolutionFloatingStyle && typeof document !== "undefined"
				? createPortal((
					<div
						className={classes.visualEvolutionFloating}
						style={visualEvolutionFloatingStyle}
						onClick={(event) => event.stopPropagation()}
					>
						<p className={classes.visualEvolutionTitle}>
							{visualEvolutionPanel.kind === "codebase"
								? "Codebase visual evolution"
								: (visualEvolutionSubtrack
									? `Visual evolution - ${visualEvolutionSubtrack.name}`
									: "Visual evolution")}
						</p>
						{visualEvolutionPanel.kind === "codebase" ? (
							codebaseVisualScreenshots.length > 0 ? (
								<div className={classes.visualEvolutionScroller}>
									{codebaseVisualScreenshots.map((marker) => (
										<figure key={marker.id} className={classes.visualEvolutionFrame}>
											<div className={classes.visualEvolutionMedia}>
												<img
													src={marker.imageDataUrl}
													alt={`System screenshot from ${formatDate(marker.occurredAt)}`}
													className={classes.visualEvolutionImage}
												/>
											</div>
											<figcaption className={classes.visualEvolutionTimestamp}>
												{formatDate(marker.occurredAt)}
											</figcaption>
										</figure>
									))}
								</div>
							) : (
								<div className={classes.visualEvolutionEmpty}>
									{VISUAL_EVOLUTION_EMPTY_TEXT}
								</div>
							)
						) : (
							visualEvolutionSubtrackCrops.length > 0 ? (
								<div className={classes.visualEvolutionScroller}>
									{visualEvolutionSubtrackCrops.map((preview) => {
										const scaledWidth = Math.round(preview.imageWidth * preview.scale);
										const scaledHeight = Math.round(preview.imageHeight * preview.scale);
										const offsetX = -Math.round(preview.cropX * preview.scale);
										const offsetY = -Math.round(preview.cropY * preview.scale);
										return (
											<figure key={`${preview.markerId}-${preview.cropX}-${preview.cropY}`} className={classes.visualEvolutionFrame}>
												<div
													className={classes.visualEvolutionCrop}
													style={{
														width: `${preview.displayWidth}px`,
														height: `${preview.displayHeight}px`,
													}}
												>
													<img
														src={preview.imageDataUrl}
														alt={`Component crop from ${formatDate(preview.occurredAt)}`}
														className={classes.visualEvolutionCropImage}
														style={{
															width: `${scaledWidth}px`,
															height: `${scaledHeight}px`,
															transform: `translate(${offsetX}px, ${offsetY}px)`,
														}}
													/>
												</div>
												<figcaption className={classes.visualEvolutionTimestamp}>
													{formatDate(preview.occurredAt)}
												</figcaption>
											</figure>
										);
									})}
								</div>
							) : (
								<div className={classes.visualEvolutionEmpty}>
									{VISUAL_EVOLUTION_EMPTY_TEXT}
								</div>
							)
						)}
					</div>
				), document.body)
				: null}

			{stageMenu && (
				<div
					className={classes.stageDropdown}
					style={{ left: stageMenu.x, top: stageMenu.y }}
					onClick={(event) => event.stopPropagation()}
				>
					<select
						value={parsed.subStages.find((subStage) => subStage.id === stageMenu.subStageId)?.stage ?? ""}
						disabled={readOnly}
						onChange={(event) => {
							if (readOnly) return;
							updateSubStageStage(stageMenu.subStageId, event.target.value);
							setStageMenu(null);
						}}
						onBlur={() => setStageMenu(null)}
						autoFocus
					>
						<option value="">(none)</option>
						{defaultStages.map((stageName) => (
							<option key={stageName} value={stageName}>
								{stageName}
							</option>
						))}
					</select>
				</div>
			)}

			{nameEdit && (
				<input
					className={classes.nameEditor}
					style={{ left: nameEdit.x, top: nameEdit.y }}
					value={nameEdit.value}
					autoFocus
					onClick={(event) => event.stopPropagation()}
					onChange={(event) =>
						setNameEdit((previous) =>
							previous ? { ...previous, value: event.target.value } : previous
						)
					}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							commitNameEdit();
						}

						if (event.key === "Escape") {
							setNameEdit(null);
						}
					}}
					onBlur={commitNameEdit}
				/>
			)}

			<StagePicker
				isOpen={!!tagPicker}
				x={tagPicker?.x ?? 0}
				y={tagPicker?.y ?? 0}
				currentValue={
					tagPicker ? parsed.subStages.find((subStage) => subStage.id === tagPicker.id)?.stage ?? "" : ""
				}
				options={defaultStages}
				onClose={() => setTagPicker(null)}
				onCreate={(value) => {
					if (readOnly) return;
					onStageCreation(value);
				}}
				onSelect={(value) => {
					if (readOnly) return;
					if (!tagPicker) return;

					onStageUpdate({
						id: tagPicker.id,
						end: tagPicker.end,
						start: tagPicker.start,
						name: value,
					});

					setTagPicker(null);
				}}
			/>

			{milestoneMenu && (
				<MilestoneMenu
					x={milestoneMenu.x}
					y={milestoneMenu.y}
					onCreate={
						!readOnly && milestoneMenu.date !== ""
							? () => {
								dispatch(
									addDesignStudyEvent({
										id: crypto.randomUUID(),
										name: "Untitled",
										occurredAt: fromDate(milestoneMenu.date),
										generatedBy: "manual",
									})
								);
							}
							: undefined
					}
					onDelete={
						!readOnly && selectedMilestone
							? () => {
								dispatch(deleteDesignStudyEvent(selectedMilestone.id));
							}
							: undefined
					}
					onClose={() => {
						setMilestoneMenu(null);
						setSelectedMilestone(null);
					}}
				/>
			)}
		</>
	);
};
