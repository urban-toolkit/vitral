import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, matchPath, useLocation } from "react-router-dom";

import { useSession } from "@/auth/sessionContext";
import { hasDeclinedGuestMode } from "@/auth/guestDeclined";
import { LoadSpinner } from "@/components/project/LoadSpinner";

/**
 * The one URL shape allowed to answer the login screen on a reader's behalf.
 *
 * `codeToUrl` prints exactly `/project/<id>?ref=<CODE>&n=<node>&at=<instant>` into every card entry
 * of an exported report, and `ref` is read back by exactly one screen. Both halves of this test are
 * required, for different reasons:
 *
 * - **The path**, because `ref` is also the web's ordinary referral parameter. Matching a bare `ref`
 *   anywhere would let `/projects?ref=twitter` put a visitor into guest mode — a state that outlives
 *   the click — in exchange for a parameter that screen does not even read. `matchPath` is exact by
 *   default, so `/project/:id/setup` is excluded, which is right: that screen is nothing but edits.
 * - **A non-empty `ref`**, and deliberately *not* a parseable one. `resolveLocatorReference` owns the
 *   grammar, and a reader who followed a mistyped code is far better served by the canvas naming the
 *   code it could not find than by a login screen that explains nothing. All this decides is whether
 *   somebody arrived here from a document.
 *
 * `location.pathname` is basename-stripped by the router — the same assumption the `state.from` round
 * trip below has always made.
 */
function carriesReportReference(pathname: string, search: string): boolean {
    if (!matchPath("/project/:projectId", pathname)) return false;
    const reference = new URLSearchParams(search).get("ref");
    return reference !== null && reference.trim() !== "";
}

/**
 * The gate in front of every project screen.
 *
 * Only `anonymous` is turned away — a guest has answered the login screen and is entitled to the
 * whole app. `loading` renders the spinner rather than redirecting, because deciding before the
 * session request comes back would bounce a signed-in user to the login screen on every reload.
 *
 * `anonymous` now has **three** outcomes rather than two. A code printed in a paper has to open the
 * canvas, and a login screen is where most readers stop; so a visit carrying a report reference is
 * answered by entering guest mode here, and everything else still meets `/login`.
 */
export function RequireSession({ children }: { children: ReactNode }) {
    const { session, continueAsGuest } = useSession();
    const location = useLocation();

    const invited = carriesReportReference(location.pathname, location.search);
    /**
     * Refuse to act on an `anonymous` the provider could not establish.
     *
     * `SessionProvider` reaches `anonymous` both when the server said nobody and when the session
     * request *failed*, and in the second case this browser may still be carrying a live cookie.
     * `continueAsGuest` signs the browser out over the network, which really would delete that
     * session row — so without this test a proxy hiccup plus a link in a PDF is enough to sign a
     * researcher out of every tab and every device, with no interaction and nothing on screen. It
     * would also hand any third-party page a cross-origin logout: navigate a Vitral user to
     * `/project/anything?ref=x` and hope their session lookup fails.
     *
     * An unverified anonymous falls through to `/login` exactly as before, and loses nothing —
     * `state.from` carries the whole reference across.
     *
     * **And refuse to overrule somebody who has already said no.** The reference now survives in the
     * address bar after arrival, so that a reader who copies their own URL hands on a link that
     * works — which also means `invited` stays true for every later load of that page. Without
     * `hasDeclinedGuestMode` the owner of a project could sign out, reload, and be signed back in as
     * a guest by their own citation link, with no way off the page. Convenience for a first-time
     * reader must not outrank an explicit gesture by whoever is actually sitting there.
     */
    const mayAutoGuest = session.status === "anonymous"
        && session.verified
        && invited
        && !hasDeclinedGuestMode();

    /**
     * Whether the automatic guest entry has been started, and whether it has finished.
     *
     * Two values, deliberately of two different kinds, because they are read in two different places.
     *
     * **Started is a ref**, claimed *before* the await and never read during render. `continueAsGuest`
     * ends the session over the network, so `session.status` stays `anonymous` across at least one
     * more commit: a guard read off the session would fire the request again on every render until it
     * resolved, and `StrictMode` invokes this effect twice in development, which is the same bug in
     * miniature. A ref survives both; a state setter would not, because the second invocation reads
     * the same stale value.
     *
     * **Settled is state**, because the render below has to see it. It answers a question `started`
     * cannot: "we are anonymous *again*" rather than "we are anonymous *still*". That case is real —
     * the unavailable-project screen offers a reader an account, which leaves guest mode — and
     * without it this component would hold the spinner forever, the effect refusing to re-fire and
     * the render refusing to redirect.
     */
    const autoGuestStarted = useRef(false);
    const [autoGuestSettled, setAutoGuestSettled] = useState(false);

    useEffect(() => {
        if (!mayAutoGuest) return;
        if (autoGuestStarted.current) return;

        autoGuestStarted.current = true;
        void continueAsGuest({ remember: false })
            // `continueAsGuest` sets the session from its own `finally`, so this browser is a guest
            // whether or not the sign-out reached the server — which is the point of writing it
            // there. Caught only so an unreachable backend does not surface as an unhandled rejection
            // on a screen that has already moved on.
            .catch(() => undefined)
            .finally(() => setAutoGuestSettled(true));
    }, [mayAutoGuest, continueAsGuest]);

    if (session.status === "loading") return <LoadSpinner loading />;

    if (session.status === "anonymous") {
        // The whole race, avoided in one line. `<Navigate>` navigates from an effect of its own, and
        // React flushes a child's effects before its parent's — so returning it here would put the
        // reader on the login screen this exists to skip, and the effect above would then enter guest
        // mode on a page nobody is looking at. The same spinner as the `loading` branch, so the wait
        // reads as one wait rather than two.
        if (mayAutoGuest && !autoGuestSettled) return <LoadSpinner loading />;

        // `state.from` so the login screen can send them back where they were headed; `replace`
        // so the back button does not land on a guarded page they still cannot see.
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    return <>{children}</>;
}
