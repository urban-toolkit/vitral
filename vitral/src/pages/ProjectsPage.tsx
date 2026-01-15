import { useState } from 'react';

import { loadDocuments } from "@/api/stateApi";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import type { DocumentResponse } from "@/api/stateApi";

import classes from './ProjectsPage.module.css'

export function ProjectsPage() {
    const navigate = useNavigate();

    const [documents, setDocuments] = useState<DocumentResponse[]>([]);

    const fetchDocuments = async () => {
        const fetchedDocuments = await loadDocuments();

        setDocuments(fetchedDocuments);
    };

    useEffect(()=>{
        fetchDocuments();
    }, [])

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
                                <button onClick={() => navigate("/project/"+document.id)}>Open</button>
                            </div>
                        </div>
                    })}
                </div>
            </div>
        </div>
    );
}
