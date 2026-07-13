import React, { useEffect, useRef, useState } from 'react';
import useCandidateCameraSession from '../hooks/useCandidateCameraSession';
import SuperAdminDashboard from './SuperAdminDashboard';
import './SuperAdminWorkspace.css';

const LAYOUTS = [
    { id: 'split', label: 'Split' },
    { id: 'interview-wide', label: 'Whisperer wide' },
    { id: 'admin-wide', label: 'Admin wide' },
    { id: 'interview', label: 'Whisperer' },
    { id: 'admin', label: 'Admin' },
];

const VALID_LAYOUTS = new Set(LAYOUTS.map(({ id }) => id));

function initialLayout() {
    try {
        const saved = localStorage.getItem('superadmin_workspace_layout');
        if (VALID_LAYOUTS.has(saved)) return saved;
    } catch {
        // Storage can be unavailable in hardened browser sessions.
    }
    return 'split';
}

function CandidateCameraOverlay({ camera, onClose }) {
    const videoRef = useRef(null);

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = camera.candidateStream;
    }, [camera.candidateStream]);

    const quality = camera.quality?.width
        ? `${camera.quality.width}x${camera.quality.height} | ${camera.quality.fps || 0} fps`
        : 'Candidate live';

    return (
        <aside className="saw-camera-overlay" aria-label="Candidate camera preview">
            <div className="saw-camera-overlay-header">
                <div>
                    <strong>Candidate camera</strong>
                    <span>{quality}</span>
                </div>
                <button type="button" onClick={onClose} title="Hide camera preview" aria-label="Hide camera preview">&times;</button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted />
        </aside>
    );
}

export default function SuperAdminWorkspace({ interviewContent }) {
    const [layout, setLayout] = useState(initialLayout);
    const [cameraOverlay, setCameraOverlay] = useState(true);
    const camera = useCandidateCameraSession();

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
        return () => {
            document.body.style.overflow = '';
            document.body.style.height = '';
        };
    }, []);

    const selectLayout = (nextLayout) => {
        setLayout(nextLayout);
        try { localStorage.setItem('superadmin_workspace_layout', nextLayout); } catch { /* optional */ }
    };

    const interviewVisible = layout !== 'admin';
    const showCameraOverlay = interviewVisible && cameraOverlay && Boolean(camera.candidateStream);

    return (
        <div className={`saw-workspace saw-layout-${layout}`}>
            <header className="saw-toolbar">
                <div className="saw-toolbar-title">
                    <strong>Interview Whisperer</strong>
                    <span>Superadmin workspace</span>
                    <span className="saw-unlimited-badge">Unlimited</span>
                </div>

                <div className="saw-layout-switcher" role="group" aria-label="Workspace layout">
                    {LAYOUTS.map((option) => (
                        <button
                            type="button"
                            key={option.id}
                            className={layout === option.id ? 'active' : ''}
                            aria-pressed={layout === option.id}
                            onClick={() => selectLayout(option.id)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    className={`saw-camera-toggle ${cameraOverlay ? 'active' : ''}`}
                    disabled={!camera.candidateStream || !interviewVisible}
                    aria-pressed={cameraOverlay}
                    onClick={() => setCameraOverlay((current) => !current)}
                >
                    Camera overlay
                </button>
            </header>

            <div className="saw-canvas">
                <section className="saw-pane saw-pane-interview" aria-label="Interview Whisperer">
                    {interviewContent}
                    {showCameraOverlay && (
                        <CandidateCameraOverlay camera={camera} onClose={() => setCameraOverlay(false)} />
                    )}
                </section>
                <section className="saw-pane saw-pane-admin" aria-label="Superadmin controls">
                    <SuperAdminDashboard embedded candidateCamera={camera} />
                </section>
            </div>
        </div>
    );
}
