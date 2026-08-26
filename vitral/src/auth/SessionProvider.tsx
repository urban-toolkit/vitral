import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
    fetchSession,
    loginAccount,
    logoutAccount,
    registerAccount,
} from "@/api/authApi";
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
    const [session, setSession] = useState<Session>({ status: "loading" });

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
    }, []);

    const signIn = useCallback(async (input: { username: string; password: string }) => {
        const user = await loginAccount(input);
        writeGuestFlag(false);
        setSession({ status: "user", user });
    }, []);

    const signUp = useCallback(async (input: {
        username: string;
        password: string;
        email?: string;
    }) => {
        const user = await registerAccount(input);
        writeGuestFlag(false);
        setSession({ status: "user", user });
    }, []);

    const signOut = useCallback(async () => {
        try {
            await logoutAccount();
        } finally {
            // Locally signed out even if the request failed: leaving the UI claiming a session the
            // user has asked to end is worse than a session row that expires on its own.
            writeGuestFlag(false);
            setSession({ status: "anonymous" });
        }
    }, []);

    const continueAsGuest = useCallback(() => {
        writeGuestFlag(true);
        setSession({ status: "guest" });
    }, []);

    const leaveGuestMode = useCallback(() => {
        writeGuestFlag(false);
        setSession({ status: "anonymous" });
    }, []);

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
