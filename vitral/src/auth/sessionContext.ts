import { createContext, useContext } from "react";

import type { AccountUser } from "@/api/authApi";

/**
 * Who is using the app right now.
 *
 * `guest` is a real third state, not "signed out with extra steps": a guest gets the whole editor
 * and their projects live in this browser only (`localProjectStore`), so the app has to be able to
 * tell "chose to work locally" apart from "has not answered the login screen yet". `anonymous` is
 * the second of those, and it is the only state that redirects to `/login`.
 */
export type Session =
    | { status: "loading" }
    | { status: "anonymous" }
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
    continueAsGuest: () => void;
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
