import { useRef, useState, type ChangeEvent } from 'react';

import { loadDocuments, deleteDocument, importProjectVi, startDuplicateDocument, loadDuplicateDocumentJob, convertDocumentToReviewOnly } from "@/api/stateApi";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { DocumentResponse } from "@/api/stateApi";

import classes from './ProjectsPage.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faPlus } from '@fortawesome/free-solid-svg-icons';
import { githubStatus } from '@/api/githubApi';

export function ProjectsPage() {
    const navigate = useNavigate();

    const [documents, setDocuments] = useState<DocumentResponse[]>([]);
    const [importingProject, setImportingProject] = useState(false);
    const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
    const [convertingProjectId, setConvertingProjectId] = useState<string | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const fetchDocuments = async () => {
        const fetchedDocuments = await loadDocuments();

        setDocuments(fetchedDocuments);
    };

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

    useEffect(()=>{
        void fetchDocuments().catch((error) => {
            console.error("Failed to load documents", error);
        });
        void checkGitStatus().catch((error) => {
            console.error("Failed to check GitHub status", error);
        });
    }, []);

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

            while (job.status === "queued" || job.status === "running") {
                await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 1000);
                });
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

    const handleConvertProjectToReviewMode = async (document: DocumentResponse) => {
        if (convertingProjectId) return;
        if (document.review_only) return;

        const title = (document.title ?? "").trim() || "Untitled";
        const confirmed = window.confirm(
            `Convert "${title}" to review mode permanently?\n\n` +
            `This cannot be undone and editing will be disabled forever.`,
        );
        if (!confirmed) return;

        setConvertingProjectId(document.id);
        try {
            const updated = await convertDocumentToReviewOnly(document.id);
            setDocuments((prevDocuments) => {
                return prevDocuments.map((entry) => {
                    if (entry.id !== updated.id) return entry;
                    return { ...entry, ...updated };
                });
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to convert project to review mode.";
            window.alert(message);
        } finally {
            setConvertingProjectId(null);
        }
    };

    return (
        <div className={classes.pageContainer}>
            <div className={classes.innerContent}>
                <div className={classes.headerRow}>
                    <h1 className={classes.title}>Projects</h1>
                    <button
                        type="button"
                        className={classes.importButton}
                        onClick={() => importInputRef.current?.click()}
                        disabled={importingProject}
                    >
                        {importingProject ? "Importing..." : "Import project"}
                    </button>
                    <input
                        ref={importInputRef}
                        type="file"
                        accept=".vi"
                        className={classes.hiddenInput}
                        onChange={handleImportProject}
                    />
                </div>

                <div className={classes.projectsGrid}>
                    {documents.map((document) => {
                        const projectTitle = (document.title ?? "").trim() || "Untitled";
                        return <article key={document.id} className={classes.projectCard}>
                            <div className={classes.cardHeader}>
                                <h2 className={classes.documentTitle} title={projectTitle}>{projectTitle}</h2>
                                {document.review_only ? (
                                    <span className={classes.reviewBadge}>Review only</span>
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
                                    disabled={duplicatingProjectId !== null || convertingProjectId !== null}
                                >
                                    {duplicatingProjectId === document.id ? "Duplicating..." : "Duplicate"}
                                </button>
                                <button
                                    type="button"
                                    className={classes.secondaryAction}
                                    onClick={() => void handleConvertProjectToReviewMode(document)}
                                    disabled={Boolean(document.review_only) || convertingProjectId !== null || duplicatingProjectId !== null}
                                >
                                    {convertingProjectId === document.id ? "Converting..." : (document.review_only ? "Review only" : "Make review only")}
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
            </div>
        </div>
    );
}
