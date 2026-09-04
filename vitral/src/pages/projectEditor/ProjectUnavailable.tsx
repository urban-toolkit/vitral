import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useSession } from "@/auth/sessionContext";

import styles from "./ProjectUnavailable.module.css";

/**
 * What a reader sees when the project behind a link will not open for them.
 *
 * This screen exists because of the automatic guest mode in `RequireSession`. A reader following a
 * citation out of a paper no longer meets the login screen — which is the point — so if the project
 * turns out not to be published, the sign-in they used to be offered has to be offered *here*
 * instead. Without it the whole flow reads as "that link is broken" to the one person most likely to
 * have an account: the study's own author, opening their own report on a machine they have not signed
 * in on.
 *
 * The server answers **404 for a private project and for one that does not exist alike**, and that is
 * deliberate — a 403 would confirm that an id names somebody's real work. So this screen cannot claim
 * the project exists, and does not: it says what the reader can do about either case.
 */
export function ProjectUnavailable({ isGuest }: { isGuest: boolean }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { leaveGuestMode } = useSession();

    /**
     * The reference is still in the address bar, and that is not luck.
     *
     * `ProjectEditorPage` strips `?ref=&n=&at=` only after a *successful* load, so a load that failed
     * leaves the whole citation there — which is what makes it possible both to show it back to the
     * reader below and to hand it to the login screen as somewhere to return to.
     */
    const from = location.pathname + location.search;
    const reference = new URLSearchParams(location.search).get("ref");

    const handleSignIn = useCallback(() => {
        // Leaving guest mode first is required, not defensive. `LoginPage` bounces a `guest` session
        // straight back to its destination the moment it mounts, so navigating there while still a
        // guest would return the reader to this very screen in one frame.
        leaveGuestMode();
        navigate("/login", { state: { from } });
    }, [leaveGuestMode, navigate, from]);

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <h1 className={styles.title}>This project is not available</h1>
                <p className={styles.body}>
                    It has not been published, or it belongs to an account this browser is not signed
                    in to. Published projects open for anyone with the link.
                </p>
                {reference !== null && reference.trim() !== "" ? (
                    <p className={styles.reference}>
                        The link asked for <code>{reference}</code>. That reference will still resolve
                        once the project opens.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    {isGuest ? (
                        <button type="button" className={styles.primary} onClick={handleSignIn}>
                            Sign in
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => navigate("/projects")}
                    >
                        All projects
                    </button>
                </div>
            </div>
        </div>
    );
}
