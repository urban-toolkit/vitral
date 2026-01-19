import '@xyflow/react/dist/style.css';

import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectEditorPage } from "@/pages/ProjectEditorPage";

const router = createBrowserRouter([
  { path: "/", element: <ProjectsPage /> },
  { path: "/projects", element: <ProjectsPage /> },
  { path: "/project/:projectId", element: <ProjectEditorPage /> },
]);

export default function App() {
    return <RouterProvider router={router} />;
}