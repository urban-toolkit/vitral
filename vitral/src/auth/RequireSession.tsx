import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useSession } from "@/auth/sessionContext";
import { LoadSpinner } from "@/components/project/LoadSpinner";

/**
 * The gate in front of every project screen.
 *
 * Only `anonymous` is turned away — a guest has answered the login screen and is entitled to the
 * whole app. `loading` renders the spinner rather than redirecting, because deciding before the
 * session request comes back would bounce a signed-in user to the login screen on every reload.
 */
export function RequireSession({ children }: { children: ReactNode }) {
    const { session } = useSession();
    const location = useLocation();

    if (session.status === "loading") return <LoadSpinner loading />;

    if (session.status === "anonymous") {
        // `state.from` so the login screen could send them back where they were headed; `replace`
        // so the back button does not land on a guarded page they still cannot see.
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    return <>{children}</>;
}
