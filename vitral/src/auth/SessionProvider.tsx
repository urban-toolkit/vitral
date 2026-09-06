import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
    fetchSession,
    loginAccount,
    logoutAccount,
    registerAccount,
} from "@/api/authApi";
import { setGuestApiMode } from "@/api/guestMode";
import { writeGuestDeclined } from "@/auth/guestDeclined";
import { SessionContext, type Session, type SessionContextValue } from "@/auth/sessionContext";

/**
 * Guest mode is a decision, and it has to survive a reload — otherwise every refresh bounces a
 * guest back to the login screen and away from work that only exists in this browser.
 */
const GUEST_FLAG_KEY = "vitral.guest";

/**
 * The same fact with a shorter life.
 *
 * `RequireSession` enters guest mode for a reader who followed a reference link out of an exported
 * report, and that is not a decision they made. Writing `vitral.guest` for it would mean one click in
 * a PDF quietly skips the login screen on that machine from then on. `sessionStorage` gives it the
 * lifetime the gesture deserves: it survives reloading the tab the link opened, and goes when the tab
 * does. It is copied into a tab opened *from* that one, which is the behaviour a reader following a
 * link out of the canvas would want anyway.
 */
const GUEST_SESSION_FLAG_KEY = "vitral.guest.session";

function readGuestFlag(): boolean {
    // Either store means guest. Separate try/catch because a browser that refuses one may still
    // answer the other, and because both throw on *access* in a private window rather than
    // returning null.
    try {
        if (window.localStorage.getItem(GUEST_FLAG_KEY) === "1") return true;
    } catch {
        // Fall through and ask the session store.
    }
    try {
        return window.sessionStorage.getItem(GUEST_SESSION_FLAG_KEY) === "1";
    } catch {
        return false;
    }
}

/**
 * Setting writes exactly one store; **clearing clears both**.
 *
 * `signIn`, `signUp`, `signOut`, `leaveGuestMode` and an account found on mount all end guest mode
 * outright, and a flag left behind in the other store would reinstate it on the next load.
 */
function writeGuestFlag(value: boolean, remember = true): void {
    try {
        if (!value) window.localStorage.removeItem(GUEST_FLAG_KEY);
        else if (remember) window.localStorage.setItem(GUEST_FLAG_KEY, "1");
    } catch {
        // A guest whose browser refuses storage still gets this session; they just get asked again
        // next time. Failing the sign-in over it would be worse.
    }
    try {
        if (!value) window.sessionStorage.removeItem(GUEST_SESSION_FLAG_KEY);
        else if (!remember) window.sessionStorage.setItem(GUEST_SESSION_FLAG_KEY, "1");
    } catch {
        // Same trade as above.
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
                // `verified`: the server answered, and the answer was nobody.
                setSession(readGuestFlag()
                    ? { status: "guest" }
                    : { status: "anonymous", verified: true });
            } catch {
                if (cancelled) return;
                // The backend being unreachable must not lock a guest out of work that is in their
                // own browser and needs no backend at all.
                //
                // `verified: false`, and it is load-bearing. This browser may still be holding a live
                // cookie that we simply could not ask about, so anything that would *act* on being
                // signed out has to decline here. `RequireSession`'s automatic guest mode is exactly
                // that: it calls `logoutAccount()`, which really would delete the session row.
                setSession(readGuestFlag()
                    ? { status: "guest" }
                    : { status: "anonymous", verified: false });
            }
        })();

        return () => { cancelled = true; };
    }, [setSession]);

    const signIn = useCallback(async (input: { username: string; password: string }) => {
        const user = await loginAccount(input);
        writeGuestFlag(false);
        writeGuestDeclined(false);
        setSession({ status: "user", user });
    }, [setSession]);

    const signUp = useCallback(async (input: {
        username: string;
        password: string;
        email?: string;
    }) => {
        const user = await registerAccount(input);
        writeGuestFlag(false);
        writeGuestDeclined(false);
        setSession({ status: "user", user });
    }, [setSession]);

    const signOut = useCallback(async () => {
        try {
            await logoutAccount();
        } finally {
            // Locally signed out even if the request failed: leaving the UI claiming a session the
            // user has asked to end is worse than a session row that expires on its own.
            writeGuestFlag(false);
            // And it has to *stay* signed out. On a URL still carrying `?ref=` — which is every URL
            // reached from a citation now that the reference survives arrival — the automatic guest
            // entry would otherwise let the browser straight back in on the next render.
            writeGuestDeclined(true);
            setSession({ status: "anonymous", verified: true });
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
     * That reasoning applies *more* to `RequireSession`'s automatic entry than to this button, not
     * less — it decides off `anonymous`, which is precisely the state named above as untrustworthy
     * about cookies. Which is why the automatic path additionally refuses to act on an `anonymous`
     * the provider could not verify: unconditional here means "whoever asked, sign the browser out
     * first", not "any state that looks signed out may ask".
     *
     * The request failing must not block the choice: a guest's work needs no backend at all, so the
     * flag is written either way.
     */
    const continueAsGuest = useCallback(async (options?: { remember?: boolean }) => {
        try {
            await logoutAccount();
        } finally {
            writeGuestFlag(true, options?.remember ?? true);
            // Reachable while a refusal stands only by asking for guest mode outright — the automatic
            // path is vetoed by it — so arriving here is the refusal being withdrawn.
            writeGuestDeclined(false);
            setSession({ status: "guest" });
        }
    }, [setSession]);

    const leaveGuestMode = useCallback(() => {
        writeGuestFlag(false);
        // The unavailable-project screen offers a reader an account, and it is reached *from* a
        // reference link — so without this the automatic entry would put them back in guest mode
        // before the login screen could render.
        writeGuestDeclined(true);
        setSession({ status: "anonymous", verified: true });
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
