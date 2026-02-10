import { useEffect, useState } from 'react';

import classes from './GithubFiles.module.css';
import { getGitHubContents, getGithubDocumentLink, getGitHubRepos, linkRepoToDocument, type GitHubContentItem, type GitHubDocumentResponse, type GitHubRepo } from '@/api/githubApi';
import { GitRepoModal } from '@/components/github/GitRepoModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faFile } from '@fortawesome/free-solid-svg-icons';

type GithubFilesProps = {
    projectId: string;
    connectionStatus: { connected: boolean, user?: { id: number, login: string } };
};

export function GitHubFiles({ projectId, connectionStatus }: GithubFilesProps) {

    const [githubDocumentLink, setGithubDocumentLink] = useState<GitHubDocumentResponse>({});
    const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
    const [modalOpen, setModalOpen] = useState<boolean>(false);

    const [currentPath, setCurrentPath] = useState(""); // repo root
    const [items, setItems] = useState<GitHubContentItem[]>([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [itemsError, setItemsError] = useState<string | null>(null);

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
        } catch (e: any) {
            setItemsError(e?.message ?? "Failed to load repo contents");
            setItems([]);
        } finally {
            setItemsLoading(false);
        }
    };

    const openModal = () => {
        setModalOpen(true);
    }

    const closeModal = () => {
        setModalOpen(false);
    }

    useEffect(() => {
        if (!connectionStatus.connected) return;

        (async () => {
            const info = await retrieveGithubLinkInformation();
            await retrieveGithubRepos();

            // if repo linked, load root contents
            if (info.github_owner && info.github_repo) {
                setCurrentPath("");
                await loadContents("");
            }
        })();
    }, [connectionStatus.connected, projectId]);

    // reload contents when navigating folders
    useEffect(() => {
        if (!githubDocumentLink.github_owner || !githubDocumentLink.github_repo) return;
        loadContents(currentPath);
    }, [currentPath]);

    return (
        <div className={classes.container}>
            <p className={classes.title}>Github</p>

            {
                !connectionStatus.connected
                    ?
                    <>
                        <p>Sign in with your GitHub account to integrate files and events.</p>
                        <button className={classes.linkButton} onClick={() => {
                            window.location.href = `${import.meta.env.VITE_BACKEND_URL}/api/auth/github/start?returnTo=/project/${encodeURIComponent(projectId)}`;
                        }}>Connect GiHub</button>
                    </>
                    :
                    githubDocumentLink.github_repo && githubDocumentLink.github_repo != ""
                        ?
                        <>
                            <p style={{ margin: 0 }}>Signed in as {connectionStatus.user?.login}.</p>
                            <p style={{ margin: 0 }}>Repository: <span style={{ fontWeight: "bold" }}>{githubDocumentLink.github_repo}</span>.</p>
                            <p style={{ margin: 0 }}>Linked by: {githubDocumentLink.github_owner}.</p>
                            <p style={{ margin: 0 }}>Default branch: {githubDocumentLink.github_default_branch}.</p>

                            <div style={{ marginTop: 10 }}>
                                <div>
                                    <p style={{ opacity: 0.75, fontSize: "var(--font-size-sm)" }}>
                                        Path: <b>/{currentPath || ""}</b>
                                    </p>
                                    {currentPath && (
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
                                    )}
                                    <button className={classes.linkButton} onClick={() => setCurrentPath("")}>
                                        Root
                                    </button>
                                </div>

                                {itemsLoading ? (
                                    <p style={{ marginTop: 8 }}>Loading files…</p>
                                ) : itemsError ? (
                                    <p style={{ marginTop: 8, color: "crimson" }}>{itemsError}</p>
                                ) : (
                                    <ul style={{ marginTop: 8, paddingLeft: 16, maxHeight: "200px", overflowY: "auto" }}>
                                        {items.map((it) => (
                                            <li key={it.path} style={{ marginBottom: 4 }} className={classes.fileList}>
                                                {it.type === "dir" ? (
                                                    <button
                                                        style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0 }}
                                                        onClick={() => setCurrentPath(it.path)}
                                                        title="Open folder"
                                                    >
                                                        <FontAwesomeIcon icon={faFolder} /> {it.name}
                                                    </button>
                                                ) : (
                                                    <span title={it.path}><FontAwesomeIcon icon={faFile} /> {it.name}</span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </>
                        :
                        <>
                            <p>Signed in as {connectionStatus.user?.login}.</p>
                            <button className={classes.linkButton} onClick={() => { openModal(); }}>
                                Link repository
                            </button>
                        </>
            }

            <GitRepoModal
                isOpen={modalOpen}
                repos={githubRepos}
                onClose={closeModal}
                onSelectRepo={async (repo: GitHubRepo) => {
                    await linkRepoToDocument(projectId, repo.owner, repo.repo);
                    closeModal();
                    retrieveGithubLinkInformation();
                }}
            />
        </div>
    );
}