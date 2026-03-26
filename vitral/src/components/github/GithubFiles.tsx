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
// import { resolveApiBaseUrl, resolveAppBasePath } from "@/api/baseUrl";
import { resolveApiBaseUrl } from "@/api/baseUrl";
import { GitRepoModal } from "@/components/github/GitRepoModal";
import {
    selectHighlightedCodebaseFilePaths,
    setHoveredCodebaseFilePath,
} from "@/store/timelineSlice";
import { selectAllGitHubEvents } from "@/store/gitEventsSlice";

type GithubFilesProps = {
    projectId: string;
    connectionStatus: { connected: boolean; user?: { id: number; login: string } };
    reviewOnly?: boolean;
    className?: string;
};

const normalizePath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
const sortGitHubItems = (a: GitHubContentItem, b: GitHubContentItem) =>
    (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);

function buildSnapshotItems(allPaths: string[], currentPath: string): GitHubContentItem[] {
    const normalizedCurrentPath = normalizePath(currentPath);
    const currentPrefix = normalizedCurrentPath ? `${normalizedCurrentPath}/` : "";

    const directories = new Set<string>();
    const files = new Set<string>();

    for (const rawPath of allPaths) {
        const normalizedPath = normalizePath(rawPath);
        if (!normalizedPath) continue;
        if (normalizedCurrentPath && !normalizedPath.startsWith(currentPrefix)) continue;

        const remainder = normalizedCurrentPath
            ? normalizedPath.slice(currentPrefix.length)
            : normalizedPath;
        if (!remainder) continue;

        const segments = remainder.split("/").filter(Boolean);
        if (segments.length === 0) continue;

        const firstSegment = segments[0];
        if (!firstSegment) continue;

        if (segments.length > 1) {
            directories.add(firstSegment);
            continue;
        }

        files.add(firstSegment);
    }

    const items: GitHubContentItem[] = [];
    for (const dirName of directories) {
        items.push({
            name: dirName,
            path: normalizedCurrentPath ? `${normalizedCurrentPath}/${dirName}` : dirName,
            type: "dir",
        });
    }
    for (const fileName of files) {
        items.push({
            name: fileName,
            path: normalizedCurrentPath ? `${normalizedCurrentPath}/${fileName}` : fileName,
            type: "file",
        });
    }

    return items.sort(sortGitHubItems);
}

export const GitHubFiles = memo(function GitHubFiles({
    projectId,
    connectionStatus,
    reviewOnly = false,
    className,
}: GithubFilesProps) {
    const dispatch = useDispatch();
    const highlightedCodebaseFilePaths = useSelector(selectHighlightedCodebaseFilePaths);
    const gitEvents = useSelector(selectAllGitHubEvents);

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
    const snapshotFilePaths = useMemo(() => {
        const uniquePaths = new Set<string>();
        for (const eventData of gitEvents) {
            for (const filePath of eventData.filesAffected ?? []) {
                const normalizedPath = normalizePath(filePath);
                if (!normalizedPath) continue;
                uniquePaths.add(normalizedPath);
            }
        }
        return Array.from(uniquePaths).sort((a, b) => a.localeCompare(b));
    }, [gitEvents]);

    const snapshotItems = useMemo(
        () => buildSnapshotItems(snapshotFilePaths, currentPath),
        [currentPath, snapshotFilePaths],
    );

    const snapshotRepoLabel = useMemo(() => {
        const owner = (githubDocumentLink.github_owner ?? "").trim();
        const repo = (githubDocumentLink.github_repo ?? "").trim();
        if (owner && repo) return `${owner}/${repo}`;
        if (repo) return repo;

        for (const eventData of gitEvents) {
            const payload = eventData.payload as Record<string, unknown> | null | undefined;
            if (!payload || typeof payload !== "object") continue;
            const repository = payload.repository as Record<string, unknown> | undefined;
            const repoCandidate = typeof repository?.name === "string" ? repository.name.trim() : "";
            const ownerCandidateRaw = repository?.owner as Record<string, unknown> | undefined;
            const ownerCandidate = typeof ownerCandidateRaw?.login === "string"
                ? ownerCandidateRaw.login.trim()
                : "";
            if (ownerCandidate && repoCandidate) return `${ownerCandidate}/${repoCandidate}`;
            if (repoCandidate) return repoCandidate;
        }

        return "";
    }, [gitEvents, githubDocumentLink.github_owner, githubDocumentLink.github_repo]);

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
        if (reviewOnly) {
            setItems([]);
            setItemsError(null);
            setItemsLoading(false);
            return;
        }
        if (!connectionStatus.connected) return;

        void (async () => {
            const info = await retrieveGithubLinkInformation();
            await retrieveGithubRepos();

            if (info.github_owner && info.github_repo) {
                setCurrentPath("");
                await loadContents("");
            }
        })();
    }, [connectionStatus.connected, projectId, reviewOnly]);

    useEffect(() => {
        if (reviewOnly) return;
        if (!githubDocumentLink.github_owner || !githubDocumentLink.github_repo) return;
        void loadContents(currentPath);
    }, [currentPath, githubDocumentLink.github_owner, githubDocumentLink.github_repo, reviewOnly]);

    useEffect(() => {
        if (!reviewOnly) return;
        void retrieveGithubLinkInformation().catch(() => {
            // Best-effort metadata read for snapshot header.
        });
    }, [projectId, reviewOnly]);

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

            {reviewOnly ? (
                <>
                    <p className={classes.infoLine}>
                        Review snapshot mode.
                    </p>
                    <p className={classes.infoLine}>
                        Repository: <span className={classes.bold}>{snapshotRepoLabel || "Snapshot"}</span>.
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

                        {snapshotItems.length === 0 ? (
                            <p className={classes.loadLine}>No GitHub snapshot files available in this review project.</p>
                        ) : (
                            <ul className={classes.fileTree}>
                                {snapshotItems.map((item) => (
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
                                                className={`${classes.fileItem} ${
                                                    highlightedPathSet.has(normalizePath(item.path))
                                                        ? classes.fileItemHighlighted
                                                        : ""
                                                }`}
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
            ) : !connectionStatus.connected ? (
                <>
                    <p className={classes.infoLine}>
                        Sign in with your GitHub account to integrate files and events.
                    </p>
                    <button
                        className={classes.linkButton}
                        onClick={() => {
                            const apiBase = resolveApiBaseUrl();
                            // const appBasePath = resolveAppBasePath();
                            const returnToPath = `/project/${encodeURIComponent(projectId)}`;
                            window.location.href = `${apiBase}/auth/github/start?returnTo=${encodeURIComponent(returnToPath)}`;
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

            {!reviewOnly ? (
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
            ) : null}
        </div>
    );
});
