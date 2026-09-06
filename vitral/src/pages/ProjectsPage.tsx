import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
    loadDocuments,
    loadLocalDocuments,
    loadPublicDocuments,
    deleteDocument,
    importProjectVi,
    startDuplicateDocument,
    loadDuplicateDocumentJob,
    setDocumentPublished,
} from "@/api/stateApi";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { DocumentResponse } from "@/api/stateApi";
import { isLocalProjectId } from "@/api/localProjectStore";
import { useSession } from "@/auth/sessionContext";

import classes from './ProjectsPage.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faPlus, faFileImport } from '@fortawesome/free-solid-svg-icons';
import { githubStatus } from '@/api/githubApi';

export function ProjectsPage() {
    const navigate = useNavigate();
    const { session, user, isGuest, signOut } = useSession();

    const [documents, setDocuments] = useState<DocumentResponse[]>([]);
    const [publicDocuments, setPublicDocuments] = useState<DocumentResponse[]>([]);
    const [importingProject, setImportingProject] = useState(false);
    const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
    const [publishingProjectId, setPublishingProjectId] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    /**
     * A guest reads from the browser, an account reads from the server. Never both: a guest has no
     * session cookie, so asking the server would return the ownerless legacy projects and quietly
     * mix somebody else's work into a list that promised to be local-only.
     */
    const fetchDocuments = useCallback(async () => {
        const fetched = isGuest ? await loadLocalDocuments() : await loadDocuments();
        setDocuments(fetched);
    }, [isGuest]);

    /**
     * Published projects, for everyone — a guest included.
     *
     * Publishing is about being readable, and a guest is a reader. The route needs no session:
     * `owner_id` never matches a viewer without an account, so every row comes back
     * `is_owner: false` and the cards below offer nothing a guest cannot do.
     */
    const fetchPublicDocuments = useCallback(async () => {
        setPublicDocuments(await loadPublicDocuments());
    }, []);

    const removeDocument = async (id: string) => {
        await deleteDocument(id);
        setDocuments((prevDocuments: DocumentResponse[]) => {
            return prevDocuments.filter((document: DocumentResponse) => {
                return document.id != id;
            });
        });
    };

    const handleRemoveProject = async (document: DocumentResponse) => {
        const title = (document.title ?? "").trim() || "Untitled";
        const confirmed = window.confirm(`Delete project "${title}"? This action cannot be undone.`);
        if (!confirmed) return;

        try {
            await removeDocument(document.id);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete project.";
            window.alert(message);
        }
    };

    const checkGitStatus = async () => {
        const status = await githubStatus();
        if (status.connected) {
            console.log("Connected as", status.user.login);
        } else {
            console.log("Not connected");
        }
    }

    useEffect(() => {
        // Held until the session resolves: which list to load is the first thing this page needs
        // to know, and loading the wrong one first would flash somebody else's projects.
        if (session.status === "loading") return;

        void fetchDocuments().catch((error) => {
            console.error("Failed to load documents", error);
        });
        void fetchPublicDocuments().catch((error) => {
            console.error("Failed to load public projects", error);
        });
        void checkGitStatus().catch((error) => {
            console.error("Failed to check GitHub status", error);
        });
    }, [session.status, fetchDocuments, fetchPublicDocuments]);

    const handleImportProject = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        setImportingProject(true);
        try {
            const imported = await importProjectVi(file);
            await fetchDocuments();
            navigate(`/project/${imported.id}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to import project.";
            window.alert(message);
        } finally {
            setImportingProject(false);
        }
    };

    const handleDuplicateProject = async (id: string) => {
        if (duplicatingProjectId) return;

        setDuplicatingProjectId(id);
        try {
            const startedJob = await startDuplicateDocument(id);
            let job = startedJob;
            const pollStartedAt = Date.now();
            const maxPollDurationMs = 10 * 60 * 1000;

            /*
             * The first look is immediate, and the wait grows from there.
             *
             * The loop used to sleep a flat second *before* every poll, including the first — so a
             * small project that had already finished by the time the 202 came back still sat behind
             * a full second of nothing, and a second was the floor on "how long does duplicating take"
             * no matter what the server did. Starting at 150ms catches exactly that case, and the ramp
             * to 1500ms keeps a genuinely long duplication from being polled hundreds of times.
             *
             * The server sends `Retry-After: 1` with a non-terminal job. The first 150ms look
             * deliberately ignores it — one sub-second probe to catch an already-finished job is
             * cheaper for both sides than a second of dead UI — and the ramp settles above the hint
             * within three polls, which is the cadence the header is actually asking for.
             */
            let pollDelayMs = 150;
            while (job.status === "queued" || job.status === "running") {
                await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, pollDelayMs);
                });
                pollDelayMs = Math.min(1500, Math.round(pollDelayMs * 1.6));
                job = await loadDuplicateDocumentJob(job.jobId);
                if (Date.now() - pollStartedAt > maxPollDurationMs) {
                    throw new Error("Duplication is still running. Please refresh this page in a moment.");
                }
            }

            if (job.status === "failed") {
                throw new Error(job.error || "Failed to duplicate project.");
            }

            await fetchDocuments();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to duplicate project.";
            window.alert(message);
        } finally {
            setDuplicatingProjectId(null);
        }
    };

    /**
     * Publish or unpublish, in place of the old permanent "Make review only".
     *
     * Reversible, so there is no confirmation on publishing — the way back is the same button. The
     * confirmation is on *unpublishing*, which is the one that takes something away from people who
     * may already be reading it.
     */
    const handleTogglePublished = async (document: DocumentResponse) => {
        if (publishingProjectId) return;

        const title = (document.title ?? "").trim() || "Untitled";
        const nextPublished = !document.published;

        if (!nextPublished) {
            const confirmed = window.confirm(
                `Unpublish "${title}"?\n\nIt will disappear from Public projects and other accounts will lose access to it.`,
            );
            if (!confirmed) return;
        }

        setPublishingProjectId(document.id);
        try {
            const updated = await setDocumentPublished(document.id, nextPublished);
            setDocuments((prevDocuments) => prevDocuments.map((entry) => (
                entry.id === updated.id ? { ...entry, ...updated } : entry
            )));
            await fetchPublicDocuments();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update publishing.";
            window.alert(message);
        } finally {
            setPublishingProjectId(null);
        }
    };

    const handleSignOut = async () => {
        await signOut();
        navigate("/login", { replace: true });
    };

    /**
     * Somebody else's published work, kept out of the list of things you can act on.
     *
     * For a guest that is every published project, since a guest owns nothing — and that is
     * asserted here rather than read off `is_owner`. The server answers `is_owner` for the session
     * cookie the request carried, which is not necessarily who this screen says is using the app: a
     * second tab signing in mid-session leaves this one a guest with a live cookie, and the
     * account's own published project would then be filtered out of the only shelf a guest has.
     * The list above holds nothing but this browser's local projects, so it would be nowhere.
     */
    const otherPeoplesPublished = useMemo(() => (
        publicDocuments.filter((document) => isGuest || !document.is_owner)
    ), [publicDocuments, isGuest]);

    const accountLabel = user ? user.username : "Guest";

    return (
        <div className={classes.pageContainer}>
            <div className={classes.innerContent}>
                <div className={classes.headerRow}>
                    {/* Import sits with the title on the left; the account box keeps the right. */}
                    <div className={classes.headerLeft}>
                        <h1 className={classes.title}>Projects</h1>
                        <button
                            type="button"
                            className={classes.importButton}
                            onClick={() => importInputRef.current?.click()}
                            disabled={importingProject || isGuest}
                            // Icon-only, so the name of the action lives in the tooltip and the
                            // accessible name rather than beside it.
                            aria-label={importingProject ? "Importing project" : "Import project"}
                            title={isGuest
                                ? "Importing a project needs an account."
                                : importingProject ? "Importing..." : "Import project"}
                        >
                            <FontAwesomeIcon icon={faFileImport} />
                        </button>
                    </div>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".vi"
                        className={classes.hiddenInput}
                        onChange={handleImportProject}
                    />

                    <div className={classes.accountBox}>
                        <span className={classes.accountName} title={accountLabel}>{accountLabel}</span>
                        <button
                            type="button"
                            className={classes.accountAction}
                            onClick={() => void handleSignOut()}
                        >
                            {isGuest ? "Sign in" : "Log out"}
                        </button>
                    </div>
                </div>

                {isGuest ? (
                    <p className={classes.guestBanner}>
                        You are working as a guest. Your projects are temporary and cannot be
                        published.
                        {" "}
                        <button
                            type="button"
                            className={classes.inlineLink}
                            onClick={() => void handleSignOut()}
                        >
                            Create an account
                        </button>
                        {" "}to keep them.
                    </p>
                ) : null}

                <div className={classes.projectsGrid}>
                    {documents.map((document) => {
                        const projectTitle = (document.title ?? "").trim() || "Untitled";
                        const local = isLocalProjectId(document.id);
                        const busy = publishingProjectId !== null || duplicatingProjectId !== null;
                        return <article key={document.id} className={classes.projectCard}>
                            <div className={classes.cardHeader}>
                                <h2 className={classes.documentTitle} title={projectTitle}>{projectTitle}</h2>
                                {document.published ? (
                                    <span className={classes.publishedBadge}>Published</span>
                                ) : document.review_only ? (
                                    <span className={classes.reviewBadge}>Review only</span>
                                ) : local ? (
                                    <span className={classes.localBadge}>This browser</span>
                                ) : null}
                            </div>
                            {document.description ? (
                                <p className={classes.documentDescription}>{document.description}</p>
                            ) : (
                                <p className={classes.documentDescriptionEmpty}>No description</p>
                            )}
                            <button
                                type="button"
                                className={classes.removeButton}
                                aria-label={`Delete project ${projectTitle}`}
                                onClick={() => { void handleRemoveProject(document); }}
                            >
                                <FontAwesomeIcon icon={faXmark} />
                            </button>
                            <div className={classes.cardActions}>
                                <button
                                    type="button"
                                    className={classes.primaryAction}
                                    onClick={() => navigate("/project/"+document.id)}
                                >
                                    Open
                                </button>
                                <button
                                    type="button"
                                    className={classes.secondaryAction}
                                    onClick={() => void handleDuplicateProject(document.id)}
                                    disabled={busy}
                                >
                                    {duplicatingProjectId === document.id ? "Duplicating..." : "Duplicate"}
                                </button>
                                <button
                                    type="button"
                                    className={classes.secondaryAction}
                                    onClick={() => void handleTogglePublished(document)}
                                    disabled={busy || local || Boolean(document.review_only)}
                                    title={local
                                        ? "Guest projects live in this browser and cannot be published."
                                        : document.review_only
                                            ? "This project was permanently converted to review mode."
                                            : undefined}
                                >
                                    {publishingProjectId === document.id
                                        ? (document.published ? "Unpublishing..." : "Publishing...")
                                        : (document.published ? "Unpublish" : "Publish")}
                                </button>
                            </div>
                        </article>
                    })}
                    <button
                        type="button"
                        className={classes.newProject}
                        onClick={() => navigate("/projects/new")}
                    >
                        <FontAwesomeIcon icon={faPlus} className={classes.newProjectIcon} />
                        <span className={classes.newProjectText}>New project</span>
                    </button>
                </div>

                {otherPeoplesPublished.length > 0 ? (
                    <section className={classes.publicSection}>
                        <div className={classes.publicHeader}>
                            <h2 className={classes.publicTitle}>Public projects</h2>
                            <p className={classes.publicSubtitle}>
                                {isGuest
                                    ? "Public projects are read only."
                                    : "Published by other accounts. You can read them and duplicate them, but only their owner can change them."}
                            </p>
                        </div>
                        <div className={classes.projectsGrid}>
                            {otherPeoplesPublished.map((document) => {
                                const projectTitle = (document.title ?? "").trim() || "Untitled";
                                return <article key={document.id} className={classes.projectCard}>
                                    <div className={classes.cardHeader}>
                                        <h2 className={classes.documentTitle} title={projectTitle}>{projectTitle}</h2>
                                        <span className={classes.publishedBadge}>Published</span>
                                    </div>
                                    {document.description ? (
                                        <p className={classes.documentDescription}>{document.description}</p>
                                    ) : (
                                        <p className={classes.documentDescriptionEmpty}>No description</p>
                                    )}
                                    <p className={classes.ownerLine}>
                                        by {document.owner_username ?? "unknown"}
                                    </p>
                                    <div className={classes.cardActions}>
                                        <button
                                            type="button"
                                            className={classes.primaryAction}
                                            onClick={() => navigate("/project/"+document.id)}
                                        >
                                            Open
                                        </button>
                                        {/* A copy is created on the server and has to belong to
                                            somebody, so duplicating is an account action. A guest
                                            can still read the original. */}
                                        {isGuest ? null : (
                                            <button
                                                type="button"
                                                className={classes.secondaryAction}
                                                onClick={() => void handleDuplicateProject(document.id)}
                                                disabled={duplicatingProjectId !== null}
                                            >
                                                {duplicatingProjectId === document.id ? "Duplicating..." : "Duplicate"}
                                            </button>
                                        )}
                                    </div>
                                </article>
                            })}
                        </div>
                    </section>
                ) : null}
            </div>
        </div>
    );
}
