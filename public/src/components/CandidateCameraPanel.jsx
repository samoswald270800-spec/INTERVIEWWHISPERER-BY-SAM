import React, { useEffect, useRef, useState } from 'react';
import useCandidateCameraSession from '../hooks/useCandidateCameraSession';
import useVirtualCameraBridge from '../hooks/useVirtualCameraBridge';
import { copyText } from '../utils/clipboard';
import './CandidateCameraPanel.css';

function formatExpiry(expiresAt) {
    if (!expiresAt) return '';
    return new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CameraSwitch({ label, checked, disabled, onToggle, hint }) {
    return (
        <button
            className="iw-switch cam-switch"
            role="switch"
            aria-checked={checked}
            disabled={disabled}
            onClick={onToggle}
            title={hint || ''}
        >
            <span className="iw-switch-track"><span className="iw-switch-knob" /></span>
            <span className="iw-switch-label">{label}</span>
        </button>
    );
}

/**
 * Candidate camera card (IW Console v8, dashboard).
 */
export function CandidateCameraPanelView({ camera }) {
    const videoRef = useRef(null);
    const microphoneRef = useRef(null);
    const [monitorMicrophone, setMonitorMicrophone] = useState(true);
    const [copied, setCopied] = useState(false);
    const [trainingConsent, setTrainingConsent] = useState(false);
    const virtualCamera = useVirtualCameraBridge(camera.candidateStream);

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = camera.candidateStream;
        if (microphoneRef.current) microphoneRef.current.srcObject = camera.candidateStream;
    }, [camera.candidateStream]);

    const copyLink = () => {
        if (!camera.session?.link) return;
        copyText(camera.session.link).then((ok) => {
            if (!ok) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const stateLabel = {
        idle: 'No link',
        waiting: 'Waiting for candidate',
        connecting: 'Candidate connecting',
        live: 'Candidate live',
        failed: 'Connection failed',
    }[camera.candidateState] || camera.candidateState;

    const stateTone = camera.candidateState === 'live'
        ? 'live'
        : camera.candidateState === 'failed'
            ? 'failed'
            : camera.session ? 'waiting' : 'idle';

    const sourceFps = camera.sourceQuality?.encodedFps || camera.sourceQuality?.captureFps || 0;
    const fpsLabel = sourceFps ? `${camera.quality?.fps || 0}/${sourceFps} fps` : `${camera.quality?.fps || 0} fps`;
    const qualityLabel = camera.quality?.width
        ? `${camera.quality.width}x${camera.quality.height} · ${fpsLabel} · ${camera.quality.mbps === null ? 'measuring' : `${camera.quality.mbps.toFixed(1)} Mbps`} · ${camera.quality.jitterMs} ms jitter`
        : `expires ${formatExpiry(camera.session?.expiresAt)} · 720p target · low latency`;

    const virtualCameraLabel = virtualCamera.running
        ? 'Zoom / Teams virtual camera'
        : virtualCamera.installing
            ? 'Installing virtual camera…'
            : virtualCamera.status?.driverInstalled
                ? 'Zoom / Teams virtual camera'
                : virtualCamera.status?.installAvailable
                    ? 'Install Zoom / Teams virtual camera'
                    : 'Zoom / Teams virtual camera';

    return (
        <section className="sadash-card cam-card">
            <div className="sadash-card-head">
                <span className="sadash-card-title">Candidate camera</span>
                <span className="sadash-card-hint">browser feed for the call</span>
                <div className="sadash-spacer" />
                <span className={`cam-state-chip ${stateTone}`}>
                    <span className="cam-state-dot" />
                    {stateLabel}
                </span>
            </div>

            {!camera.session ? (
                <div className="sadash-card-body">
                    <div className="cam-explainer">
                        Create a private link and send it to the candidate — no account or install needed.
                        One browser can claim it; ending the session revokes it.
                    </div>
                    <span
                        role="checkbox"
                        aria-checked={trainingConsent}
                        tabIndex={0}
                        className="cam-consent"
                        onClick={() => setTrainingConsent((current) => !current)}
                        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setTrainingConsent((c) => !c); } }}
                    >
                        <span className={`cam-consent-box ${trainingConsent ? 'checked' : ''}`}>
                            {trainingConsent && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#052014" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            )}
                        </span>
                        <span className="cam-consent-text">
                            I confirm this is a disclosed mock interview or training session with participant consent.
                        </span>
                    </span>
                    <button
                        className={`cam-create-btn ${trainingConsent && camera.connected ? 'ready' : ''}`}
                        disabled={!camera.connected || !trainingConsent}
                        onClick={() => camera.createSession().catch(() => {})}
                    >
                        Create camera link
                    </button>
                </div>
            ) : (
                <div className="sadash-card-body">
                    <div className="cam-link-row">
                        <input aria-label="Candidate camera link" readOnly value={camera.session.link} />
                        <button className="iw-ghost-btn" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
                        <button className="cam-end-btn" onClick={camera.endSession}>End</button>
                    </div>
                    <div className="cam-workspace">
                        <div className="cam-preview">
                            <video ref={videoRef} autoPlay playsInline muted />
                            {!camera.candidateStream && (
                                <span className="cam-preview-placeholder">waiting for video</span>
                            )}
                        </div>
                        <div className="cam-controls">
                            <div className="cam-meta">{qualityLabel}</div>
                            <CameraSwitch
                                label="Mic monitoring"
                                checked={monitorMicrophone}
                                disabled={!camera.candidateStream}
                                onToggle={() => setMonitorMicrophone((current) => !current)}
                                hint="Use headphones so the call cannot pick up the monitored audio acoustically."
                            />
                            <CameraSwitch
                                label="Call audio to candidate"
                                checked={camera.relayAudioEnabled}
                                disabled={!camera.candidateStream}
                                onToggle={() => (camera.relayAudioEnabled ? camera.stopRelayAudio() : camera.startRelayAudio())}
                                hint="Sends the superadmin microphone and meeting-system audio to the candidate browser."
                            />
                            <CameraSwitch
                                label={virtualCameraLabel}
                                checked={virtualCamera.running}
                                disabled={virtualCamera.installing || (virtualCamera.running
                                    ? false
                                    : virtualCamera.status?.driverInstalled
                                        ? !camera.candidateStream
                                        : !virtualCamera.status?.installAvailable)}
                                onToggle={() => virtualCamera.running
                                    ? virtualCamera.stop()
                                    : virtualCamera.status?.driverInstalled
                                        ? virtualCamera.start()
                                        : virtualCamera.install()}
                                hint={virtualCamera.error || virtualCamera.status?.message || ''}
                            />
                        </div>
                    </div>
                </div>
            )}

            {camera.error && <div className="cam-error">{camera.error}</div>}
            <audio ref={microphoneRef} autoPlay playsInline muted={!monitorMicrophone} />
        </section>
    );
}

export default function CandidateCameraPanel() {
    const camera = useCandidateCameraSession();
    return <CandidateCameraPanelView camera={camera} />;
}
