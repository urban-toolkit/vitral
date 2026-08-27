/**
 * Whether the app currently considers itself a guest, readable from plain modules.
 *
 * `stateApi` is not a component and cannot use `useSession`, but it has to know: a guest is
 * supposed to be *nobody* as far as the server is concerned, and a session cookie left in the
 * browser makes every request speak for an account the screen says is not in use. That state is
 * reachable — a second tab signing in after this one entered guest mode leaves exactly it — and
 * while it lasts the server answers `can_edit: true` for that account's projects and accepts the
 * writes, which is how a "guest" came to be able to edit a published project it did not own.
 *
 * Kept as a module-level flag rather than threaded through thirty call sites: it is one fact about
 * the whole session, and the only writer is `SessionProvider`, which owns that fact already.
 */
let guestMode = false;

/** Called by `SessionProvider` whenever the session resolves or changes. */
export function setGuestApiMode(value: boolean): void {
    guestMode = value;
}

export function isGuestApiMode(): boolean {
    return guestMode;
}

/**
 * What to pass as `credentials` on an API call.
 *
 * `authApi` deliberately does not use this: signing in has to be able to *receive* a cookie, and
 * signing out has to be able to clear one, both of which are exactly how guest mode is entered.
 */
export function apiCredentials(): RequestCredentials {
    return guestMode ? "omit" : "include";
}
