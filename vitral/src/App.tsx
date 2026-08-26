import '@xyflow/react/dist/style.css';

import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectEditorPage } from "@/pages/ProjectEditorPage";
import { ProjectSetupPage } from "@/pages/ProjectSetupPage";
import { LoginPage } from "@/pages/LoginPage";
import { SessionProvider } from "@/auth/SessionProvider";
import { RequireSession } from "@/auth/RequireSession";

/** Every project screen sits behind the session gate; `/login` is the only way in without one. */
function guarded(element: React.ReactNode) {
  return <RequireSession>{element}</RequireSession>;
}

function resolveRouterBasename(): string {
  const baseUrl = String(import.meta.env.BASE_URL ?? "/").trim();
  if (baseUrl === "" || baseUrl === "/") return "/";
  const withoutTrailingSlash = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  return withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash
    : `/${withoutTrailingSlash}`;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: guarded(<ProjectsPage />) },
  { path: "/projects", element: guarded(<ProjectsPage />) },
  { path: "/projects/new", element: guarded(<ProjectSetupPage />) },
  { path: "/project/:projectId/setup", element: guarded(<ProjectSetupPage />) },
  { path: "/project/:projectId", element: guarded(<ProjectEditorPage />) },
],
  {
    basename: resolveRouterBasename(),
  }
);

export default function App() {
    // The provider wraps the router, not a layout route: the guard and every page read the same
    // session, and one mount-time lookup answers for all of them.
    return (
        <SessionProvider>
            <RouterProvider router={router} />
        </SessionProvider>
    );
}
