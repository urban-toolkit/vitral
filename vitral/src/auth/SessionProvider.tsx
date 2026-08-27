import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
    fetchSession,
    loginAccount,
    logoutAccount,
    registerAccount,
} from "@/api/authApi";
import { setGuestApiMode } from "@/api/guestMode";
import { SessionContext, type Session, type SessionContextValue } from "@/auth/sessionContext";

/**
 * Guest mode is a decision, and it has to survive a reload — otherwise every refresh bounces a
 * guest back to the login screen and away from work that only exists in this browser.
 */
const GUEST_FLAG_KEY = "vitral.guest";

function readGuestFlag(): boolean {
    try {
        return window.localStorage.getItem(GUEST_FLAG_KEY) === "1";
    } catch {
        // Private windows and blocked site data throw on access rather than returning null.
        return false;
    }
}

function writeGuestFlag(value: boolean): void {
    try {
        if (value) window.localStorage.setItem(GUEST_FLAG_KEY, "1");
        else window.localStorage.removeItem(GUEST_FLAG_KEY);
    } catch {
        // A guest whose browser refuses storage still gets this session; they just get asked again
        // next time. Failing the sign-in over it would be worse.
    }
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [session, setSessionState] = useState<Session>({ status: "loading" });

    /**
     * The only way this component changes the session, so the flag `stateApi` reads can never fall
     * out of step with the one the UI reads (`api/guestMode.ts`).
     *
     * Set here rather than in an effect, and that is the whole point: React runs a child's effects
     * *before* its parent's, so an effect here would land after the page below had already mounted
     * and issued its first document request — which is exactly the request that must not carry an
     * account's cookie.
     */
    const setSession = useCallback((next: Session) => {
        setGuestApiMode(next.status === "guest");
        setSessionState(next);
    }, []);

    // One call on mount decides which screen the app opens on. The cookie is httpOnly, so the
    // client cannot read it — asking the server is the only way to know.
    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const user = await fetchSession();
                if (cancelled) return;
                if (user) {
                    // An account beats a stale guest flag: signing in is the stronger statement.
                    writeGuestFlag(false);
                    setSession({ status: "user", user });
                    return;
                }
                setSession(readGuestFlag() ? { status: "guest" } : { status: "anonymous" });
            } catch {
                if (cancelled) return;
                // The backend being unreachable must not lock a guest out of work that is in their
                // own browser and needs no backend at all.
                setSession(readGuestFlag() ? { status: "guest" } : { status: "anonymous" });
            }
        })();

        return () => { cancelled = true; };
    }, [setSession]);

    const signIn = useCallback(async (input: { username: string; password: string }) => {
        const user = await loginAccount(input);
        writeGuestFlag(false);
        setSession({ status: "user", user });
    }, [setSession]);

    const signUp = useCallback(async (input: {
        username: string;
        password: string;
        email?: string;
    }) => {
        const user = await registerAccount(input);
        writeGuestFlag(false);
        setSession({ status: "user", user });
    }, [setSession]);

    const signOut = useCallback(async () => {
        try {
            await logoutAccount();
        } finally {
            // Locally signed out even if the request failed: leaving the UI claiming a session the
            // user has asked to end is worse than a session row that expires on its own.
            writeGuestFlag(false);
            setSession({ status: "anonymous" });
        }
    }, [setSession]);

    /**
     * Guest means *no account*, so this ends whatever session the browser is carrying.
     *
     * Unconditionally, and not only when `session.status === "user"`: the case worth defending
     * against is the one where the client does not know about the cookie yet. This screen renders
     * its form while the session lookup is still in flight, and a second tab that signed in after
     * this one loaded leaves a live cookie behind a UI that says "anonymous". Either way the result
     * used to be a browser calling itself a guest while every request still carried an account —
     * which is how somebody's own published project vanished from a guest's Public projects, filed
     * under `is_owner` for an account the screen claimed not to have.
     *
     * The request failing must not block the choice: a guest's work needs no backend at all, so the
     * flag is written either way.
     */
    const continueAsGuest = useCallback(async () => {
        try {
            await logoutAccount();
        } finally {
            writeGuestFlag(true);
            setSession({ status: "guest" });
        }
    }, [setSession]);

    const leaveGuestMode = useCallback(() => {
        writeGuestFlag(false);
        setSession({ status: "anonymous" });
    }, [setSession]);

    const value = useMemo<SessionContextValue>(() => ({
        session,
        user: session.status === "user" ? session.user : null,
        isGuest: session.status === "guest",
        signIn,
        signUp,
        signOut,
        continueAsGuest,
        leaveGuestMode,
    }), [session, signIn, signUp, signOut, continueAsGuest, leaveGuestMode]);

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
