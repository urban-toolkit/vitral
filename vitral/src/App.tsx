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

    // const existingDocId = localStorage.getItem("vitral_doc_id") ?? undefined;
    // const { docId, status, error, resetDoc } = useDocumentSync(existingDocId);

    // return (
    //     <div style={{ width: '100vw', height: '100vh' }}>

    //         <div style={{ position: "absolute", top: 12, right: 1000, zIndex: 10 }}>
    //             <div>doc: {docId ?? "creating..."}</div>
    //             <div>status: {status}</div>
    //             {error && <div style={{ color: "crimson" }}>{error}</div>}
    //             <button onClick={resetDoc}>New document</button>
    //         </div>

    //         <ReactFlow
    //             nodes={nodes}
    //             edges={edges}
    //             onNodesChange={(e) => dispatch(onNodesChange(e))}
    //             onEdgesChange={(e) => dispatch(onEdgesChange(e))}
    //             // onConnect={onConnect}
    //             nodeTypes={nodeTypes}
    //             fitView
    //         />

    //         {/* Calls to action */}
    //         <div style={{ position: 'fixed', right: '30px', top: '30px' }}>
    //             <img src="/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
    //         </div>

    //         <div style={{ position: 'fixed', left: '30px', bottom: '30px' }}>
    //             <img src="/cta_click_to_type.png" alt="Click and type to instantiate cards." />
    //         </div>

    //         {/* Document title */}
    //         <Title />

    //         <FileDropZone 
    //             onFileSelected={async (file: File) => {
    //                 setLoading(true);

    //                 const data: fileData = await parseFile(file);
    //                 const response: {cards: {entity: string, title: string, description: string}[]} = await requestCardsLLM(data);

    //                 console.log(response);

    //                 if(response && response.cards){
    //                     console.log("response", response);
    //                     let newNodes = llmCardsToNodes(response.cards, nodes);

    //                     console.log(newNodes);

    //                     dispatch(addNodes(newNodes));
    //                 }

    //                 setLoading(false);
    //             }}
    //             loading={loading}
    //             accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
    //         />
    //     </div>
    // );
}