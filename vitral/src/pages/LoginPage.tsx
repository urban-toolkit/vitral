import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AuthError, type CredentialProblem } from "@/api/authApi";
import { useSession } from "@/auth/sessionContext";
import { isSafeInternalPath } from "@/routing";
// Imported rather than referenced from `public/`, so Vite fingerprints it and resolves it against
// whatever base path the app is served under — `/vitral/` in production, `/` in dev.
import logoUrl from "@/assets/logo.png";

import classes from "./LoginPage.module.css";

type Mode = "login" | "register";

/**
 * The one screen in front of everything else.
 *
 * Three ways out, and they are deliberately not equal: signing in and creating an account are the
 * form, and "continue as a guest" is set apart below a rule — it is a real choice, but one with a
 * consequence (the work stays in this browser) that the note under it states plainly rather than
 * leaving the researcher to discover after a week of notes.
 */
export function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { session, signIn, signUp, continueAsGuest } = useSession();

    /**
     * Where to send them once they are through, which is not always the projects list.
     *
     * `RequireSession` records the guarded path it turned away, and until now this screen threw that
     * away and went to `/projects` regardless — so a link to a particular study, or to one artifact
     * inside it, died here. That is the whole point of a shared reference: somebody follows a code
     * from a paper, meets the login screen once, and lands on the thing the code named.
     *
     * Checked by `isSafeInternalPath` rather than trusted. Nothing writes `state.from` from a URL
     * today, but the moment this value became a navigation target it became worth guarding.
     */
    const destination = useMemo(() => {
        const from = (location.state as { from?: unknown } | null)?.from;
        return isSafeInternalPath(from) ? from : "/projects";
    }, [location.state]);

    const [mode, setMode] = useState<Mode>("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [problems, setProblems] = useState<CredentialProblem[]>([]);

    // Anyone who already has a session has no business on this screen — including someone who
    // reaches it with the back button after signing in. This has to honour `destination` too: a
    // signed-in reader following a reference link is bounced here for one frame while the session
    // request settles, and sending them to `/projects` would lose the link they clicked.
    useEffect(() => {
        if (session.status === "user" || session.status === "guest") {
            navigate(destination, { replace: true });
        }
    }, [session.status, navigate, destination]);

    const problemFor = useCallback((field: CredentialProblem["field"]) => (
        problems.find((problem) => problem.field === field)?.message ?? null
    ), [problems]);

    const switchMode = useCallback((next: Mode) => {
        setMode(next);
        // The password is cleared but the username is not: switching because "that account does
        // not exist" means retyping the same name, and switching because "that name is taken"
        // means changing it — either way the field is where they are already looking.
        setPassword("");
        setError(null);
        setProblems([]);
    }, []);

    const handleSubmit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setError(null);
        setProblems([]);

        try {
            if (mode === "login") {
                await signIn({ username, password });
            } else {
                await signUp({ username, password, email });
            }
            navigate(destination, { replace: true });
        } catch (caught) {
            if (caught instanceof AuthError) {
                setError(caught.message);
                setProblems(caught.problems);
            } else {
                // A network failure, not a rejected credential — say which, because "wrong username
                // or password" would send someone hunting for a typo that is not there.
                setError("Could not reach the server. Check your connection and try again.");
            }
            setSubmitting(false);
        }
    }, [submitting, mode, signIn, signUp, username, password, email, navigate, destination]);

    const handleGuest = useCallback(async () => {
        // Awaited: entering guest mode signs the browser out first, and navigating before that
        // lands on the projects page with a cookie the guest is not supposed to have.
        await continueAsGuest();
        navigate(destination, { replace: true });
    }, [continueAsGuest, navigate, destination]);

    const submitLabel = mode === "login"
        ? (submitting ? "Signing in..." : "Sign in")
        : (submitting ? "Creating account..." : "Create account");

    return (
        <div className={classes.page}>
            <div className={classes.brand}>
                <img className={classes.logo} src={logoUrl} alt="Vitral" />
                <p className={classes.tagline}>
                    Sense-making canvases for design research.
                </p>
            </div>

            <div className={classes.card}>
                <div className={classes.tabs} role="tablist" aria-label="Sign in or create an account">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "login"}
                        className={mode === "login" ? classes.tabActive : classes.tab}
                        onClick={() => switchMode("login")}
                        disabled={submitting}
                    >
                        Log in
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "register"}
                        className={mode === "register" ? classes.tabActive : classes.tab}
                        onClick={() => switchMode("register")}
                        disabled={submitting}
                    >
                        Create account
                    </button>
                </div>

                <form className={classes.form} onSubmit={handleSubmit}>
                    {error ? <p className={classes.error} role="alert">{error}</p> : null}

                    <label className={classes.field}>
                        <span className={classes.fieldLabel}>Username</span>
                        <input
                            className={`${classes.input} ${problemFor("username") ? classes.inputInvalid : ""}`}
                            type="text"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoComplete="username"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            autoFocus
                            required
                            disabled={submitting}
                        />
                        {problemFor("username")
                            ? <span className={classes.fieldError}>{problemFor("username")}</span>
                            : null}
                    </label>

                    <label className={classes.field}>
                        <span className={classes.fieldLabel}>Password</span>
                        <input
                            className={`${classes.input} ${problemFor("password") ? classes.inputInvalid : ""}`}
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete={mode === "login" ? "current-password" : "new-password"}
                            required
                            disabled={submitting}
                        />
                        {problemFor("password")
                            ? <span className={classes.fieldError}>{problemFor("password")}</span>
                            : mode === "register"
                                ? <span className={classes.fieldHint}>At least 8 characters.</span>
                                : null}
                    </label>

                    {mode === "register" ? (
                        <label className={classes.field}>
                            <span className={classes.fieldLabel}>
                                Email <span className={classes.optional}>(optional)</span>
                            </span>
                            <input
                                className={`${classes.input} ${problemFor("email") ? classes.inputInvalid : ""}`}
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                autoComplete="email"
                                disabled={submitting}
                            />
                            {problemFor("email")
                                ? <span className={classes.fieldError}>{problemFor("email")}</span>
                                : (
                                    <span className={classes.fieldHint}>
                                        Only used if you ever need to be contacted about your projects.
                                    </span>
                                )}
                        </label>
                    ) : null}

                    <button className={classes.primaryButton} type="submit" disabled={submitting}>
                        {submitLabel}
                    </button>
                </form>

                <div className={classes.divider}>or</div>

                <button
                    type="button"
                    className={classes.guestButton}
                    onClick={() => void handleGuest()}
                    disabled={submitting}
                >
                    Continue as a guest
                </button>
                <p className={classes.guestNote}>
                    Guest projects are saved in this browser only. They are not backed up, cannot be
                    published, and are lost if you clear your browser data.
                </p>
            </div>
        </div>
    );
}
