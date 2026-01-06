import { useState, useCallback } from 'react';
import { ReactFlow, applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Card } from '@/components/Card';
import { Title } from '@/components/Title';

const initialNodes = [
    { id: 'n1', position: { x: -200, y: 0 }, type: 'card', data: { label: 'person', type: "social", title: "Fabio" } },
    { id: 'n2', position: { x: 0, y: 0 }, type: 'card', data: { label: 'event', type: "social", title: "Meeting", description: "In this meeting we define the concept of knowledge management." } },
    { id: 'n3', position: { x: 200, y: 0 }, type: 'card', data: { label: 'requirement', type: "technical", title: "Temperature Dataset" } },
];

// const initialEdges = [{ id: 'n1-n2', source: 'n1', target: 'n2' }];

const nodeTypes = {
    card: Card,
};

export default function App() {
    const [nodes, setNodes] = useState(initialNodes);
    // const [edges, setEdges] = useState(initialEdges);

    const onNodesChange = useCallback(
        (changes: any) => setNodes((nodesSnapshot) => applyNodeChanges(changes, nodesSnapshot)),
        [],
    );
    // const onEdgesChange = useCallback(
    //   (changes: any) => setEdges((edgesSnapshot) => applyEdgeChanges(changes, edgesSnapshot)),
    //   [],
    // );
    // const onConnect = useCallback(
    //   (params: any) => setEdges((edgesSnapshot) => addEdge(params, edgesSnapshot)),
    //   [],
    // );

    return (
        <div style={{ width: '100vw', height: '100vh' }}>
            <ReactFlow
                nodes={nodes}
                // edges={edges}
                onNodesChange={onNodesChange}
                // onEdgesChange={onEdgesChange}
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
        </div>
    );
}