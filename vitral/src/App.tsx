import '@xyflow/react/dist/style.css';

import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectEditorPage } from "@/pages/ProjectEditorPage";
import { ProjectSetupPage } from "@/pages/ProjectSetupPage";

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
  { path: "/", element: <ProjectsPage /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/projects/new", element: <ProjectSetupPage /> },
  { path: "/project/:projectId/setup", element: <ProjectSetupPage /> },
  { path: "/project/:projectId", element: <ProjectEditorPage /> },
],
  {
    basename: resolveRouterBasename(),
  }
);

export default function App() {
    return <RouterProvider router={router} />;
}
