import { useRef, useState, type ChangeEvent } from 'react';

import { loadDocuments, deleteDocument, importProjectVi } from "@/api/stateApi";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { DocumentResponse } from "@/api/stateApi";

import classes from './ProjectsPage.module.css';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { githubStatus } from '@/api/githubApi';

export function ProjectsPage() {
    const navigate = useNavigate();

    const [documents, setDocuments] = useState<DocumentResponse[]>([]);
    const [importingProject, setImportingProject] = useState(false);
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

    const checkGitStatus = async () => {
        const status = await githubStatus();
        if (status.connected) {
            console.log("Connected as", status.user.login);
        } else {
            console.log("Not connected");
        }
    }

    useEffect(()=>{
        fetchDocuments();
        checkGitStatus();
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

    return (
        <div className={classes.pageContainer}>
            <div className={classes.innerContent}>
                <div className={classes.headerRow}>
                    <p className={classes.title}>Projects</p>
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
                        return <div key={document.id} className={classes.projectCard}>
                            <div className={classes.innerCard}>
                                {document.review_only ? (
                                    <span className={classes.reviewBadge}>Review only</span>
                                ) : null}
                                <p className={classes.documentTitle}>{document.title}</p>
                                <p>{document.description}</p>
                                <p>{document.id}</p>
                                <FontAwesomeIcon className={classes.removeIcon} icon={faXmark} onClick={() => {removeDocument(document.id)}}/>
                                <button onClick={() => navigate("/project/"+document.id)}>Open</button>
                            </div>
                        </div>
                    })}
                    <div className={classes.newProject}>
                        <p className={classes.documentTitle}>Untitled</p>
                        <button onClick={() => navigate("/projects/new")}>New project</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
