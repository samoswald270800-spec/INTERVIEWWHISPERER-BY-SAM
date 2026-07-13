import React, { useCallback, useEffect, useRef, useState } from 'react';
import './CameraOverlayTile.css';

const CAMERA_POSITION_STORAGE_KEY = 'superadmin_camera_overlay_position';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function initialCameraPosition() {
    try {
        const saved = JSON.parse(localStorage.getItem(CAMERA_POSITION_STORAGE_KEY));
        if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
    } catch { /* the default corner remains available when storage is blocked */ }
    return null;
}

/**
 * Candidate camera overlay tile (IW Console v8).
 * Floating 300px card over the Whisperer view. Header drags the tile
 * (clamped to the parent, persisted), double-click resets the position.
 */
export default function CameraOverlayTile({ camera, onClose }) {
    const videoRef = useRef(null);
    const overlayRef = useRef(null);
    const dragRef = useRef(null);
    const positionRef = useRef(null);
    const [position, setPosition] = useState(initialCameraPosition);
    const [dragging, setDragging] = useState(false);

    const candidateStream = camera?.candidateStream || null;
    const live = Boolean(candidateStream);

    useEffect(() => {
        if (videoRef.current && candidateStream) videoRef.current.srcObject = candidateStream;
    }, [candidateStream]);

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

    const quality = camera?.quality?.width
        ? `${camera.quality.width}x${camera.quality.height} | ${camera.quality.fps || 0} fps`
        : null;

    const positionStyle = position
        ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' }
        : undefined;

    return (
        <aside
            ref={overlayRef}
            className={`cam-tile ${dragging ? 'is-dragging' : ''}`}
            style={positionStyle}
            aria-label="Candidate camera preview"
        >
            <div
                className="cam-tile-header"
                onPointerDown={startDrag}
                onDoubleClick={resetPosition}
                title="Drag to move. Double-click to reset."
            >
                <svg width="10" height="14" viewBox="0 0 10 16" fill="#52525E">
                    <circle cx="2.5" cy="2.5" r="1.4" /><circle cx="7.5" cy="2.5" r="1.4" />
                    <circle cx="2.5" cy="8" r="1.4" /><circle cx="7.5" cy="8" r="1.4" />
                    <circle cx="2.5" cy="13.5" r="1.4" /><circle cx="7.5" cy="13.5" r="1.4" />
                </svg>
                <span className="cam-tile-title">Candidate camera</span>
                <span className={`cam-tile-state ${live ? 'live' : 'waiting'}`}>
                    <span className="cam-tile-state-dot" />
                    {live ? (quality || 'live') : 'waiting'}
                </span>
                <div className="cam-tile-spacer" />
                <button className="cam-tile-close" onClick={onClose} title="Close">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div className="cam-tile-body">
                {live ? (
                    <video ref={videoRef} autoPlay playsInline muted />
                ) : (
                    <span className="cam-tile-placeholder">waiting for candidate video</span>
                )}
            </div>
        </aside>
    );
}
