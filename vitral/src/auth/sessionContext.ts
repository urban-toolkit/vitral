import { createContext, useContext } from "react";

import type { AccountUser } from "@/api/authApi";

/**
 * Who is using the app right now.
 *
 * `guest` is a real third state, not "signed out with extra steps": a guest gets the whole editor
 * and their projects live in this browser only (`localProjectStore`), so the app has to be able to
 * tell "chose to work locally" apart from "has not answered the login screen yet". `anonymous` is
 * the second of those, and it is the only state that redirects to `/login`.
 *
 * **`anonymous` carries whether it was actually established.** The provider reaches it two ways: the
 * server answered "nobody", and the session request *failed*. They look identical and are not: after
 * a failure the browser may still be holding a live cookie the client simply could not ask about.
 * Anything that acts destructively on being signed out — `RequireSession`'s automatic guest mode ends
 * the session over the network — must know the difference, or a flaky request becomes a way to sign
 * somebody out of every tab they have open.
 */
export type Session =
    | { status: "loading" }
    | { status: "anonymous"; verified: boolean }
    | { status: "guest" }
    | { status: "user"; user: AccountUser };

export type SessionContextValue = {
    session: Session;
    /** Convenience readers, so callers do not re-derive the same three checks everywhere. */
    user: AccountUser | null;
    isGuest: boolean;
    signIn: (input: { username: string; password: string }) => Promise<void>;
    signUp: (input: { username: string; password: string; email?: string }) => Promise<void>;
    signOut: () => Promise<void>;
    /**
     * Enters guest mode. Async because it ends any session the browser still carries — a guest
     * with a live cookie is signed in as far as the server is concerned.
     *
     * `remember` defaults to true: "Continue as a guest" on the login screen is a decision, and a
     * decision has to survive closing the browser. `RequireSession` passes `false` for the guest mode
     * it enters on a reader's behalf, which is not a decision they made and must not outlive the tab.
     * It changes how long the flag lives and nothing else — the sign-out is not optional for either
     * caller.
     */
    continueAsGuest: (options?: { remember?: boolean }) => Promise<void>;
    /** Leaves guest mode without signing in — sends the user back to the login screen. */
    leaveGuestMode: () => void;
};

/**
 * Kept apart from `SessionProvider` because a module that exports both a component and a hook
 * breaks React Fast Refresh for everything that imports it.
 */
export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
    const value = useContext(SessionContext);
    if (!value) throw new Error("useSession must be used inside a SessionProvider");
    return value;
}
