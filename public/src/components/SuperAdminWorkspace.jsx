import React, { useCallback, useEffect, useRef, useState } from 'react';
import useCandidateCameraSession from '../hooks/useCandidateCameraSession';
import SuperAdminDashboard from './SuperAdminDashboard';
import StatusPill from './StatusPill';
import './SuperAdminWorkspace.css';

const WORKSPACE_STORAGE_KEY = 'superadmin_workspace_layout_state';
const CAMERA_POSITION_STORAGE_KEY = 'superadmin_camera_overlay_position';

const LAYOUTS = [
    { id: 'split', label: 'Balanced', detail: '50 / 50', orientation: 'columns', ratio: 50 },
    { id: 'interview-wide', label: 'Whisperer wide', detail: '65 / 35', orientation: 'columns', ratio: 65 },
    { id: 'admin-wide', label: 'Admin wide', detail: '35 / 65', orientation: 'columns', ratio: 35 },
    { id: 'interview-focus', label: 'Whisperer focus', detail: '75 / 25', orientation: 'columns', ratio: 75 },
    { id: 'admin-focus', label: 'Admin focus', detail: '25 / 75', orientation: 'columns', ratio: 25 },
    { id: 'stacked', label: 'Stacked', detail: '50 / 50', orientation: 'rows', ratio: 50 },
    { id: 'interview-tall', label: 'Whisperer tall', detail: '65 / 35', orientation: 'rows', ratio: 65 },
    { id: 'admin-tall', label: 'Admin tall', detail: '35 / 65', orientation: 'rows', ratio: 35 },
    { id: 'interview', label: 'Whisperer only', detail: 'Full workspace', full: 'interview' },
    { id: 'admin', label: 'Admin only', detail: 'Full workspace', full: 'admin' },
];

const LAYOUTS_BY_ID = new Map(LAYOUTS.map((layout) => [layout.id, layout]));

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function initialWorkspaceState() {
    try {
        const savedState = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY));
        if (LAYOUTS_BY_ID.has(savedState?.layout)) {
            const option = LAYOUTS_BY_ID.get(savedState.layout);
            return {
                layout: option.id,
                splitPercent: Number.isFinite(savedState.splitPercent)
                    ? clamp(savedState.splitPercent, 20, 80)
                    : (option.ratio || 50),
            };
        }

        const legacyLayout = localStorage.getItem('superadmin_workspace_layout');
        if (LAYOUTS_BY_ID.has(legacyLayout)) {
            const option = LAYOUTS_BY_ID.get(legacyLayout);
            return { layout: option.id, splitPercent: option.ratio || 50 };
        }
    } catch {
        // Storage can be unavailable in hardened browser sessions.
    }
    return { layout: 'split', splitPercent: 50 };
}

function initialCameraPosition() {
    try {
        const saved = JSON.parse(localStorage.getItem(CAMERA_POSITION_STORAGE_KEY));
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
    } catch {
        // The default corner remains available when storage is blocked.
    }
    return null;
}

function LayoutPreview({ option, compact = false }) {
    const orientation = option.full ? 'full' : option.orientation;
    return (
        <span
            className={`saw-layout-preview saw-preview-${orientation} ${compact ? 'saw-layout-preview-compact' : ''}`}
            style={{ '--preview-ratio': `${option.ratio || 100}%` }}
            aria-hidden="true"
        >
            {option.full === 'interview' && <span className="saw-preview-pane saw-preview-interview saw-preview-pane-full" />}
            {option.full === 'admin' && <span className="saw-preview-pane saw-preview-admin saw-preview-pane-full" />}
            {!option.full && (
                <>
                    <span className="saw-preview-pane saw-preview-interview" />
                    <span className="saw-preview-pane saw-preview-admin" />
                </>
            )}
        </span>
    );
}

function CandidateCameraOverlay({ camera, onClose }) {
    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const dragRef = useRef(null);
    const positionRef = useRef(null);
    const [position, setPosition] = useState(initialCameraPosition);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = camera.candidateStream;
    }, [camera.candidateStream]);

    useEffect(() => {
        positionRef.current = position;
    }, [position]);

    const constrainPosition = useCallback((nextPosition) => {
        const overlay = overlayRef.current;
        const parent = overlay?.parentElement;
        if (!overlay || !parent) return nextPosition;
        const parentRect = parent.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
            x: clamp(nextPosition.x, 8, Math.max(8, parentRect.width - overlayRect.width - 8)),
            y: clamp(nextPosition.y, 8, Math.max(8, parentRect.height - overlayRect.height - 8)),
        };
    }, []);

    useEffect(() => {
        if (!overlayRef.current?.parentElement || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => {
            setPosition((current) => {
                if (!current) return current;
                const next = constrainPosition(current);
                return next.x === current.x && next.y === current.y ? current : next;
            });
        });
        observer.observe(overlayRef.current.parentElement);
        return () => observer.disconnect();
    }, [constrainPosition]);

    useEffect(() => {
        if (!dragging) return undefined;

        const handleMove = (event) => {
            const overlay = overlayRef.current;
            const parent = overlay?.parentElement;
            if (!overlay || !parent || !dragRef.current) return;
            const parentRect = parent.getBoundingClientRect();
            const next = constrainPosition({
                x: event.clientX - parentRect.left - dragRef.current.offsetX,
                y: event.clientY - parentRect.top - dragRef.current.offsetY,
            });
            positionRef.current = next;
            setPosition(next);
        };
        const handleUp = () => {
            setDragging(false);
            dragRef.current = null;
            try {
                localStorage.setItem(CAMERA_POSITION_STORAGE_KEY, JSON.stringify(positionRef.current));
            } catch { /* optional */ }
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp, { once: true });
        window.addEventListener('pointercancel', handleUp, { once: true });
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    }, [constrainPosition, dragging]);

    const startDrag = (event) => {
        if (event.button !== 0 || event.target.closest('button')) return;
        const overlay = overlayRef.current;
        const parent = overlay?.parentElement;
        if (!overlay || !parent) return;
        const overlayRect = overlay.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const current = {
            x: overlayRect.left - parentRect.left,
            y: overlayRect.top - parentRect.top,
        };
        dragRef.current = {
            offsetX: event.clientX - overlayRect.left,
            offsetY: event.clientY - overlayRect.top,
        };
        positionRef.current = current;
        setPosition(current);
        setDragging(true);
        event.preventDefault();
    };

    const resetPosition = () => {
        setDragging(false);
        setPosition(null);
        positionRef.current = null;
        try { localStorage.removeItem(CAMERA_POSITION_STORAGE_KEY); } catch { /* optional */ }
    };

    const quality = camera.quality?.width
        ? `${camera.quality.width}x${camera.quality.height} | ${camera.quality.fps || 0} fps`
        : 'Candidate live';

    const positionStyle = position ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' } : undefined;

    return (
        <aside
            ref={overlayRef}
            className={`saw-camera-overlay ${dragging ? 'is-dragging' : ''}`}
            style={positionStyle}
            aria-label="Candidate camera preview"
        >
            <div
                className="saw-camera-overlay-header"
                onPointerDown={startDrag}
                onDoubleClick={resetPosition}
                title="Drag to move. Double-click to reset."
            >
                <span className="saw-camera-drag-grip" aria-hidden="true"><i /><i /><i /></span>
                <div>
                    <strong>Candidate camera</strong>
                    <span>{quality}</span>
                </div>
                <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onClose}
                    title="Hide camera preview"
                    aria-label="Hide camera preview"
                >
                    &times;
                </button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted />
        </aside>
    );
}

export default function SuperAdminWorkspace({
    interviewContent,
    status,
    isListening,
    isProcessing,
    timeLabel,
    creditsLabel,
    onOpenHistory,
    onLogout,
}) {
    const [workspaceState, setWorkspaceState] = useState(initialWorkspaceState);
    const [cameraOverlay, setCameraOverlay] = useState(true);
    const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
    const [resizing, setResizing] = useState(false);
    const [compact, setCompact] = useState(() => window.matchMedia?.('(max-width: 820px)').matches || false);
    const canvasRef = useRef(null);
    const layoutMenuRef = useRef(null);
    const resizerRef = useRef(null);
    const resizeOutputRef = useRef(null);
    const resizeRef = useRef(null);
    const splitPercentRef = useRef(workspaceState.splitPercent);
    const camera = useCandidateCameraSession();

    const currentLayout = LAYOUTS_BY_ID.get(workspaceState.layout) || LAYOUTS[0];
    const isSplitLayout = !currentLayout.full;
    const effectiveOrientation = compact && isSplitLayout ? 'rows' : currentLayout.orientation;

    useEffect(() => {
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100%';
        return () => {
            document.body.style.overflow = '';
            document.body.style.height = '';
        };
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia?.('(max-width: 820px)');
        if (!mediaQuery) return undefined;
        const updateCompact = (event) => setCompact(event.matches);
        mediaQuery.addEventListener?.('change', updateCompact);
        return () => mediaQuery.removeEventListener?.('change', updateCompact);
    }, []);

    useEffect(() => {
        if (!layoutMenuOpen) return undefined;
        const closeFromPointer = (event) => {
            if (!layoutMenuRef.current?.contains(event.target)) setLayoutMenuOpen(false);
        };
        const closeFromKeyboard = (event) => {
            if (event.key === 'Escape') setLayoutMenuOpen(false);
        };
        window.addEventListener('pointerdown', closeFromPointer);
        window.addEventListener('keydown', closeFromKeyboard);
        return () => {
            window.removeEventListener('pointerdown', closeFromPointer);
            window.removeEventListener('keydown', closeFromKeyboard);
        };
    }, [layoutMenuOpen]);

    const persistWorkspaceState = useCallback((nextState) => {
        try {
            localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(nextState));
            localStorage.setItem('superadmin_workspace_layout', nextState.layout);
        } catch { /* optional */ }
    }, []);

    const selectLayout = (option) => {
        const nextState = { layout: option.id, splitPercent: option.ratio || 50 };
        splitPercentRef.current = nextState.splitPercent;
        setWorkspaceState(nextState);
        persistWorkspaceState(nextState);
        setLayoutMenuOpen(false);
    };

    const previewSplitPercent = useCallback((nextPercent) => {
        const value = Math.round(clamp(nextPercent, 20, 80) * 10) / 10;
        splitPercentRef.current = value;
        canvasRef.current?.style.setProperty('--saw-split-percent', `${value}%`);
        resizerRef.current?.setAttribute('aria-valuenow', String(Math.round(value)));
        if (resizeOutputRef.current) {
            resizeOutputRef.current.textContent = `${Math.round(value)} / ${100 - Math.round(value)}`;
        }
    }, []);

    useEffect(() => {
        if (!resizing) return undefined;

        const handleMove = (event) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect || !resizeRef.current) return;
            const horizontal = resizeRef.current.orientation === 'columns';
            const pointer = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
            const length = horizontal ? rect.width : rect.height;
            if (length > 0) previewSplitPercent((pointer / length) * 100);
        };
        const handleUp = () => {
            setResizing(false);
            resizeRef.current = null;
            setWorkspaceState((current) => {
                const next = { ...current, splitPercent: splitPercentRef.current };
                persistWorkspaceState(next);
                return next;
            });
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp, { once: true });
        window.addEventListener('pointercancel', handleUp, { once: true });
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    }, [persistWorkspaceState, previewSplitPercent, resizing]);

    const startResize = (event) => {
        if (event.button !== 0) return;
        resizeRef.current = { orientation: effectiveOrientation };
        setResizing(true);
        event.preventDefault();
    };

    const resizeWithKeyboard = (event) => {
        const decrementKey = effectiveOrientation === 'columns' ? 'ArrowLeft' : 'ArrowUp';
        const incrementKey = effectiveOrientation === 'columns' ? 'ArrowRight' : 'ArrowDown';
        if (![decrementKey, incrementKey, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home'
            ? 20
            : event.key === 'End'
                ? 80
                : workspaceState.splitPercent + (event.key === incrementKey ? 2 : -2);
        previewSplitPercent(next);
        const nextState = { ...workspaceState, splitPercent: splitPercentRef.current };
        setWorkspaceState(nextState);
        persistWorkspaceState(nextState);
    };

    const interviewVisible = currentLayout.full !== 'admin';
    const showCameraOverlay = interviewVisible && cameraOverlay && Boolean(camera.candidateStream);
    const canvasStyle = isSplitLayout ? { '--saw-split-percent': `${workspaceState.splitPercent}%` } : undefined;

    return (
        <div className={`saw-workspace saw-layout-${currentLayout.id} ${resizing ? 'is-resizing' : ''}`}>
            <header className="saw-toolbar">
                <div className="saw-toolbar-brand">
                    <strong>Interview Whisperer</strong>
                    <span aria-hidden="true">IW</span>
                </div>

                <button
                    type="button"
                    className="saw-toolbar-command saw-history-command"
                    onClick={onOpenHistory}
                    title="Interview history"
                    aria-label="Open interview history"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 12a9 9 0 1 0 3-6.7" />
                        <path d="M3 4v5h5" />
                        <path d="M12 7v5l3 2" />
                    </svg>
                    <span>History</span>
                </button>

                <div className="saw-toolbar-metrics" aria-label="Session allowance">
                    <div>
                        <span>Time</span>
                        <strong>{timeLabel}</strong>
                    </div>
                    <div>
                        <span>Credits</span>
                        <strong>{creditsLabel}</strong>
                    </div>
                </div>

                <div className="saw-toolbar-status" aria-live="polite">
                    <StatusPill
                        status={status}
                        isListening={isListening}
                        isProcessing={isProcessing}
                    />
                </div>

                <div className="saw-layout-picker" ref={layoutMenuRef}>
                    <button
                        type="button"
                        className={`saw-layout-trigger ${layoutMenuOpen ? 'active' : ''}`}
                        aria-haspopup="menu"
                        aria-expanded={layoutMenuOpen}
                        onClick={() => setLayoutMenuOpen((open) => !open)}
                    >
                        <LayoutPreview option={currentLayout} compact />
                        <span>
                            <strong>Layout</strong>
                            <small>{currentLayout.label}</small>
                        </span>
                        <svg className="saw-layout-chevron" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m7 10 5 5 5-5" />
                        </svg>
                    </button>

                    {layoutMenuOpen && (
                        <div className="saw-layout-menu" role="menu" aria-label="Workspace layout">
                            <div className="saw-layout-menu-title">
                                <div>
                                    <strong>Workspace layout</strong>
                                    <span>Choose a preset, then drag the divider to fine-tune it.</span>
                                </div>
                                <small>{LAYOUTS.length} presets</small>
                            </div>

                            <div className="saw-layout-grid">
                                {LAYOUTS.map((option) => (
                                    <button
                                        type="button"
                                        role="menuitemradio"
                                        aria-checked={currentLayout.id === option.id}
                                        key={option.id}
                                        className={currentLayout.id === option.id ? 'active' : ''}
                                        onClick={() => selectLayout(option)}
                                    >
                                        <LayoutPreview option={option} />
                                        <span>{option.label}</span>
                                        <small>{option.detail}</small>
                                    </button>
                                ))}
                            </div>

                            <div className="saw-camera-menu-row">
                                <div>
                                    <strong>Candidate camera overlay</strong>
                                    <span>
                                        {camera.candidateStream
                                            ? 'Show the live candidate video over Interview Whisperer.'
                                            : 'Available when the candidate camera is connected.'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    role="menuitemcheckbox"
                                    className={`saw-camera-switch ${cameraOverlay ? 'active' : ''}`}
                                    disabled={!camera.candidateStream || !interviewVisible}
                                    aria-checked={cameraOverlay && Boolean(camera.candidateStream)}
                                    aria-label="Toggle candidate camera overlay"
                                    onClick={() => setCameraOverlay((current) => !current)}
                                >
                                    <span />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    className="saw-toolbar-command saw-signout-command"
                    onClick={onLogout}
                    title="Sign out"
                    aria-label="Sign out"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <path d="m16 17 5-5-5-5" />
                        <path d="M21 12H9" />
                    </svg>
                </button>
            </header>

            <div
                ref={canvasRef}
                className={`saw-canvas ${isSplitLayout ? `saw-split-${effectiveOrientation}` : 'saw-full-layout'}`}
                style={canvasStyle}
            >
                <section className="saw-pane saw-pane-interview" aria-label="Interview Whisperer">
                    {interviewContent}
                    {showCameraOverlay && (
                        <CandidateCameraOverlay camera={camera} onClose={() => setCameraOverlay(false)} />
                    )}
                </section>

                {isSplitLayout && (
                    <div
                        ref={resizerRef}
                        className={`saw-resizer saw-resizer-${effectiveOrientation}`}
                        role="separator"
                        tabIndex={0}
                        aria-label="Resize workspace panels"
                        aria-orientation={effectiveOrientation === 'columns' ? 'vertical' : 'horizontal'}
                        aria-valuemin="20"
                        aria-valuemax="80"
                        aria-valuenow={Math.round(workspaceState.splitPercent)}
                        onPointerDown={startResize}
                        onKeyDown={resizeWithKeyboard}
                        title="Drag to resize panels"
                    >
                        <span className="saw-resizer-grip" aria-hidden="true" />
                        <output ref={resizeOutputRef}>{Math.round(workspaceState.splitPercent)} / {100 - Math.round(workspaceState.splitPercent)}</output>
                    </div>
                )}

                <section className="saw-pane saw-pane-admin" aria-label="Superadmin controls">
                    <SuperAdminDashboard embedded candidateCamera={camera} />
                </section>
            </div>
        </div>
    );
}
