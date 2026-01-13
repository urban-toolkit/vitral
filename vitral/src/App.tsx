import { useState } from 'react';
import { ReactFlow } from '@xyflow/react';
import { useSelector, useDispatch } from 'react-redux';
import '@xyflow/react/dist/style.css';

import { Card } from '@/components/Card';
import { Title } from '@/components/Title';
import { FileDropZone } from '@/components/FileDropZone';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange } from '@/store/flowSlice';

import type { fileData } from '@/config/types';
import type { RootState } from '@/store';

const nodeTypes = {
    card: Card,
};

export default function App() {
    const dispatch = useDispatch();
    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);

    const [loading, setLoading] = useState(false);

    return (
        <div style={{ width: '100vw', height: '100vh' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(e) => dispatch(onNodesChange(e))}
                onEdgesChange={(e) => dispatch(onEdgesChange(e))}
                // onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
            />

            {/* Calls to action */}
            <div style={{ position: 'fixed', right: '30px', top: '30px' }}>
                <img src="/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div>

            <div style={{ position: 'fixed', left: '30px', bottom: '30px' }}>
                <img src="/cta_click_to_type.png" alt="Click and type to instantiate cards." />
            </div>

            {/* Document title */}
            <Title />

            <FileDropZone 
                onFileSelected={async (file: File) => {
                    setLoading(true);
                    const data: fileData = await parseFile(file);
                    const response: {cards: {entity: string, title: string, description: string}[]} = await requestCardsLLM(data);
                    setLoading(false);

                    console.log("response", response);
                }}
                loading={loading}
                accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
            />
        </div>
    );
}