import { memo, useEffect, useMemo, useState, type DragEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faFolder } from "@fortawesome/free-solid-svg-icons";

import classes from "./GithubFiles.module.css";
import {
    getGitHubContents,
    getGithubDocumentLink,
    getGitHubRepos,
    linkRepoToDocument,
    type GitHubContentItem,
    type GitHubDocumentResponse,
    type GitHubRepo,
} from "@/api/githubApi";
import { GitRepoModal } from "@/components/github/GitRepoModal";
import {
    selectHighlightedCodebaseFilePaths,
    setHoveredCodebaseFilePath,
} from "@/store/timelineSlice";

type GithubFilesProps = {
    projectId: string;
    connectionStatus: { connected: boolean; user?: { id: number; login: string } };
    className?: string;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "").trim();

export const GitHubFiles = memo(function GitHubFiles({
    projectId,
    connectionStatus,
    className,
}: GithubFilesProps) {
    const dispatch = useDispatch();
    const highlightedCodebaseFilePaths = useSelector(selectHighlightedCodebaseFilePaths);

    const [githubDocumentLink, setGithubDocumentLink] = useState<GitHubDocumentResponse>({});
    const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
    const [modalOpen, setModalOpen] = useState(false);

    const [currentPath, setCurrentPath] = useState("");
    const [items, setItems] = useState<GitHubContentItem[]>([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [itemsError, setItemsError] = useState<string | null>(null);

    const highlightedPathSet = useMemo(
        () => new Set(
            highlightedCodebaseFilePaths
                .map((path) => normalizePath(path))
                .filter(Boolean)
        ),
        [highlightedCodebaseFilePaths]
    );

    const retrieveGithubLinkInformation = async () => {
        const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
        setGithubDocumentLink(info);
        return info;
    };

    const retrieveGithubRepos = async () => {
        const repos: GitHubRepo[] = await getGitHubRepos();
        setGithubRepos(repos);
    };

    const loadContents = async (path: string) => {
        setItemsLoading(true);
        setItemsError(null);
        try {
            const res = await getGitHubContents(projectId, path);
            res.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
            setItems(res);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to load repo contents";
            setItemsError(message);
            setItems([]);
        } finally {
            setItemsLoading(false);
        }
    };

    useEffect(() => {
        if (!connectionStatus.connected) return;

        void (async () => {
            const info = await retrieveGithubLinkInformation();
            await retrieveGithubRepos();

            if (info.github_owner && info.github_repo) {
                setCurrentPath("");
                await loadContents("");
            }
        })();
    }, [connectionStatus.connected, projectId]);

    useEffect(() => {
        if (!githubDocumentLink.github_owner || !githubDocumentLink.github_repo) return;
        void loadContents(currentPath);
    }, [currentPath, githubDocumentLink.github_owner, githubDocumentLink.github_repo]);

    useEffect(() => {
        return () => {
            dispatch(setHoveredCodebaseFilePath(null));
        };
    }, [dispatch]);

    const handleFileDragStart = (event: DragEvent<HTMLSpanElement>, item: GitHubContentItem) => {
        event.stopPropagation();

        const payload = JSON.stringify({
            source: "github",
            path: item.path,
            name: item.name,
        });

        event.dataTransfer.setData("application/x-vitral-github-file", payload);
        event.dataTransfer.setData("text/plain", item.path);
        event.dataTransfer.setData("text", item.path);
        event.dataTransfer.effectAllowed = "copy";
    };

    return (
        <div className={`${classes.container} ${className ?? ""}`}>
            <p className={classes.title}>Github</p>

            {!connectionStatus.connected ? (
                <>
                    <p className={classes.infoLine}>
                        Sign in with your GitHub account to integrate files and events.
                    </p>
                    <button
                        className={classes.linkButton}
                        onClick={() => {
                            window.location.href = `${import.meta.env.VITE_BACKEND_URL}/api/auth/github/start?returnTo=/vitral/project/${encodeURIComponent(projectId)}`;
                        }}
                    >
                        Connect GitHub
                    </button>
                </>
            ) : githubDocumentLink.github_repo && githubDocumentLink.github_repo !== "" ? (
                <>
                    <p className={classes.infoLine}>Signed in as {connectionStatus.user?.login}.</p>
                    <p className={classes.infoLine}>
                        Repository: <span className={classes.bold}>{githubDocumentLink.github_repo}</span>.
                    </p>
                    <div className={classes.filesSection}>
                        <div className={classes.pathControls}>
                            <p className={classes.pathLine}>
                                Path: <b>/{currentPath || ""}</b>
                            </p>
                            <div>
                                {currentPath ? (
                                    <button
                                        className={classes.linkButton}
                                        onClick={() => {
                                            const parts = currentPath.split("/").filter(Boolean);
                                            parts.pop();
                                            setCurrentPath(parts.join("/"));
                                        }}
                                    >
                                        Up
                                    </button>
                                ) : null}
                                <button className={classes.linkButton} onClick={() => setCurrentPath("")}>
                                    Root
                                </button>
                            </div>
                        </div>

                        {itemsLoading ? (
                            <p className={classes.loadLine}>Loading files...</p>
                        ) : itemsError ? (
                            <p className={classes.errorLine}>{itemsError}</p>
                        ) : (
                            <ul className={classes.fileTree}>
                                {items.map((item) => (
                                    <li key={item.path} className={classes.fileList}>
                                        {item.type === "dir" ? (
                                            <button
                                                className={classes.folderButton}
                                                onClick={() => setCurrentPath(item.path)}
                                                title="Open folder"
                                            >
                                                <FontAwesomeIcon icon={faFolder} /> {item.name}
                                            </button>
                                        ) : (
                                            <span
                                                title={item.path}
                                                draggable
                                                className={`${classes.fileItem} ${
                                                    highlightedPathSet.has(normalizePath(item.path))
                                                        ? classes.fileItemHighlighted
                                                        : ""
                                                }`}
                                                onDragStart={(event) => handleFileDragStart(event, item)}
                                                onDragEnd={() => dispatch(setHoveredCodebaseFilePath(null))}
                                                onMouseEnter={() => dispatch(setHoveredCodebaseFilePath(item.path))}
                                                onMouseLeave={() => dispatch(setHoveredCodebaseFilePath(null))}
                                            >
                                                <FontAwesomeIcon icon={faFile} /> {item.name}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <p className={classes.infoLine}>Signed in as {connectionStatus.user?.login}.</p>
                    <button className={classes.linkButton} onClick={() => setModalOpen(true)}>
                        Link repository
                    </button>
                </>
            )}

            <GitRepoModal
                isOpen={modalOpen}
                repos={githubRepos}
                onClose={() => setModalOpen(false)}
                onSelectRepo={async (repo: GitHubRepo) => {
                    await linkRepoToDocument(projectId, repo.owner, repo.repo);
                    setModalOpen(false);
                    await retrieveGithubLinkInformation();
                }}
            />
        </div>
    );
});
