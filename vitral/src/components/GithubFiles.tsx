import { useEffect, useState } from 'react';

import classes from './GithubFiles.module.css';
import { getGithubDocumentLink, getGitHubRepos, type GitHubDocumentResponse, type GitHubRepo } from '@/api/githubApi';

type GithubFilesProps = {
    projectId: string;
    connectionStatus: {connected: boolean, user?: { id: number, login: string}};
};

export function GitHubFiles({ projectId, connectionStatus }: GithubFilesProps) {

    const [githubDocumentLink, setGithubDocumentLink] = useState<GitHubDocumentResponse>({});
    const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);

    const retrieveGithubLinkInformation = async () => {
        const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
        setGithubDocumentLink(info);
    };

    const retrieveGithubRepos = async () => {
        const repos: GitHubRepo[] = await getGitHubRepos();
        setGithubRepos(repos);
        console.log("Repos", repos);
    }

    useEffect(() => {
        if(connectionStatus.connected){
            retrieveGithubLinkInformation();
            retrieveGithubRepos();
        }
    }, [connectionStatus]);

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
                        <p>Signed in as {connectionStatus.user?.login}.</p>
                        <p>Repository: {githubDocumentLink.github_repo}.</p>
                        <p>Linked by: {githubDocumentLink.github_owner}.</p>
                        <p>Default branch: {githubDocumentLink.github_default_branch}.</p>
                    </>
                :
                    <>
                        <p>Signed in as {connectionStatus.user?.login}.</p>
                        <button className={classes.linkButton} onClick={() => {}}>
                            Link repository
                        </button>
                    </>


            }
        </div>
    );
}