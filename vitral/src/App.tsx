import '@xyflow/react/dist/style.css';

import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectEditorPage } from "@/pages/ProjectEditorPage";
import { ProjectSetupPage } from "@/pages/ProjectSetupPage";

const router = createBrowserRouter([
  { path: "/", element: <ProjectsPage /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/projects/new", element: <ProjectSetupPage /> },
  { path: "/project/:projectId/setup", element: <ProjectSetupPage /> },
  { path: "/project/:projectId", element: <ProjectEditorPage /> },
],
  {
    basename: "/vitral",
  }
);

export default function App() {
    return <RouterProvider router={router} />;
}
