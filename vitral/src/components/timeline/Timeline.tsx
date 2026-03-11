import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as d3 from "d3";
import classes from "./Timeline.module.css";
import type {
	BlueprintEvent,
	DesignStudyEvent,
	GitHubEvent,
	Stage,
} from "@/config/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faCaretDown, faPlus, faWandSparkles } from "@fortawesome/free-solid-svg-icons";
import { StagePicker } from "@/components/timeline/StagePicker";
import { useDispatch, useSelector } from "react-redux";
import {
	addBlueprintCodebaseLink,
	addCodebaseSubtrack,
	deleteBlueprintCodebaseLink,
	selectBlueprintCodebaseLinks,
	selectHighlightedCodebaseFilePaths,
	selectHoveredBlueprintComponentNodeId,
	addDesignStudyEvent,
	attachFileToCodebaseSubtrack,
	deleteCodebaseSubtrack,
	deleteDesignStudyEvent,
	renameCodebaseSubtrack,
	selectCodebaseSubtracks,
	selectHoveredCodebaseFilePath,
	selectAllSubStages,
	selectParticipants,
	selectSystemScreenshotMarkers,
	setHighlightedCodebaseFilePaths,
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
} from "./timelineTypes";
import { fromDate } from "./timelineUtils";
import { useParsedTimelineData } from "./useParsedTimelineData";
import { useTimelineChart } from "./useTimelineChart";

export type {
	BlueprintEvent,
	KnowledgeBaseEvent,
	TimelineEventBase,
	TimelineProps,
} from "./timelineTypes";

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
	const [systemScreenshotTooltip, setSystemScreenshotTooltip] = useState<{
		markerId: string;
		x: number;
		y: number;
	} | null>(null);
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
		key: "designStudyEvent" | "subStage" | "codebaseSubtrack";
		value: string;
	} | null>(null);

	const startCaretRef = useRef<HTMLSpanElement | null>(null);
	const endCaretRef = useRef<HTMLSpanElement | null>(null);
	const todayCaretRef = useRef<HTMLSpanElement | null>(null);
	const newStageButtonRef = useRef<HTMLSpanElement | null>(null);
	const newCodebaseSubtrackButtonRef = useRef<HTMLSpanElement | null>(null);
	const syncCodebaseButtonRef = useRef<HTMLSpanElement | null>(null);
	const llmButtonRef = useRef<HTMLSpanElement | null>(null);
	const [isSyncingCodebase, setIsSyncingCodebase] = useState(false);
	const [isGeneratingMilestones, setIsGeneratingMilestones] = useState(false);
	const [suggestingCodebaseSubtrackIds, setSuggestingCodebaseSubtrackIds] = useState<string[]>([]);

	const codebaseSubtracks = useSelector(selectCodebaseSubtracks);
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
			setSystemScreenshotTooltip(null);
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
		newCodebaseSubtrackButtonRef,
		syncCodebaseButtonRef,
		llmButtonRef,
		width,
		height,
		margin,
		defaultStages,
		parsed,
		codebaseSubtracks,
		blueprintCodebaseLinks,
		systemScreenshotMarkers,
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
		onDeleteCodebaseSubtrack: (subtrackId) => {
			if (readOnly) return;
			dispatch(deleteCodebaseSubtrack(subtrackId));
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
					date: fromDate(eventToUpdate.date),
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

	const tooltipInner = useMemo(() => {
		if (selectedEvent?.kind === "codebase") {
			return <CodebaseTooltip event={selectedEvent.event as GitHubEvent} />;
		}
		if (selectedEvent?.kind === "blueprint") {
			return <BlueprintTooltip event={selectedEvent.event as BlueprintEvent} />;
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
					setSystemScreenshotTooltip(null);
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
