import { useState } from 'react';

import { loadDocuments, deleteDocument, createDocument } from "@/api/stateApi";
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

    const addDocument = async (title: string) => {
        let res: DocumentResponse = await createDocument(title, {flow: {nodes: [], edges: []}});
        setDocuments((prevDocuments: DocumentResponse[]) => {
            return [...prevDocuments, res]
        });
    }

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

    return (
        <div className={classes.pageContainer}>
            <div className={classes.innerContent}>
                <p className={classes.title}>Projects</p>
                
                <div className={classes.projectsGrid}>
                    {documents.map((document, _index) => {
                        return <div key={document.id} className={classes.projectCard}>
                            <div className={classes.innerCard}>
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
                        <button onClick={() => {addDocument("Untitled")}}>New project</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
