import React, { useMemo, useState } from "react";
import styles from "./GitRepoModal.module.css";
import type { GitHubRepo } from "@/api/githubApi";

type GitRepoModalProps = {
    isOpen: boolean;
    repos: GitHubRepo[];
    onClose: () => void;
    onSelectRepo: (repo: GitHubRepo) => void | Promise<void>;
    title?: string;
};

export function GitRepoModal({
    isOpen,
    repos,
    onClose,
    onSelectRepo,
    title = "Link GitHub repository",
}: GitRepoModalProps) {
    const [query, setQuery] = useState("");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();

        if (!q) return repos;
        return repos.filter((r) => {
            const s = `${r.fullName} ${r.defaultBranch}`.toLowerCase();
            return s.includes(q);
        });
    }, [repos, query]);

    if (!isOpen) return null;

    return (
        <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true">
            <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <div className={styles.title}>{title}</div>
                    <button className={styles.close} onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                <div className={styles.body}>
                    <input
                        className={styles.search}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search repos (owner/name)…"
                    />

                    <div className={styles.list}>
                        {filtered.length === 0 ? (
                            <div className={styles.empty}>No repositories match your search.</div>
                        ) : (
                            filtered.map((repo) => {
                                console.log(repo);
                                
                                return <button
                                    key={repo.fullName}
                                    className={styles.row}
                                    onClick={() => onSelectRepo(repo)}
                                    title={`Link ${repo.fullName}`}
                                >
                                    <div className={styles.rowMain}>
                                        <div className={styles.fullName}>{repo.fullName}</div>
                                        <div className={styles.meta}>
                                            <span className={styles.badge}>{repo.private ? "Private" : "Public"}</span>
                                            <span className={styles.dot}>•</span>
                                            <span>default: {repo.defaultBranch}</span>
                                            <span className={styles.dot}>•</span>
                                            <span>updated {formatRelativeDate(repo.updatedAt)}</span>
                                        </div>
                                    </div>
                                </button>
                            })
                        )}
                    </div>
                </div>

                <div className={styles.footer}>
                    <button className={styles.secondary} onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

function formatRelativeDate(iso: string) {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;

    const diffMs = Date.now() - dt.getTime();
    const sec = Math.floor(diffMs / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);

    if (day >= 7) return dt.toLocaleDateString();
    if (day >= 1) return `${day}d ago`;
    if (hr >= 1) return `${hr}h ago`;
    if (min >= 1) return `${min}m ago`;
    return `just now`;
}
