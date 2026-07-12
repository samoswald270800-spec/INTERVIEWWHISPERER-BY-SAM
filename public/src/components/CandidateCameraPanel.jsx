import React, { useEffect, useRef, useState } from 'react';
import useCandidateCameraSession from '../hooks/useCandidateCameraSession';
import useVirtualCameraBridge from '../hooks/useVirtualCameraBridge';
import './CandidateCameraPanel.css';

function formatExpiry(expiresAt) {
    if (!expiresAt) return '';
    return new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CandidateCameraPanel() {
    const camera = useCandidateCameraSession();
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

    const copyLink = async () => {
        if (!camera.session?.link) return;
        await navigator.clipboard.writeText(camera.session.link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const stateLabel = {
        idle: 'No link',
        waiting: 'Waiting for candidate',
        connecting: 'Candidate connecting',
        live: 'Candidate live',
        failed: 'Connection failed',
    }[camera.candidateState] || camera.candidateState;
    const qualityLabel = camera.quality?.width
        ? `${camera.quality.width}x${camera.quality.height} | ${camera.quality.fps || 0} fps | ${camera.quality.mbps === null ? 'measuring bitrate' : `${camera.quality.mbps.toFixed(1)} Mbps`} | ${camera.quality.jitterMs} ms jitter`
        : `720p target | up to 60 fps | ${camera.webrtcState}`;

    return (
        <section className="candidate-relay-panel">
            <div className="candidate-relay-heading">
                <div>
                    <h2>Candidate camera</h2>
                    <p>Browser camera feed for the superadmin call.</p>
                </div>
                <span className={`candidate-relay-state ${camera.candidateState}`}>{stateLabel}</span>
            </div>

            {!camera.session ? (
                <div className="candidate-relay-empty">
                    <div>
                        <p>Create a private link, then send it to the candidate. They do not need an account or an installation.</p>
                        <label className="candidate-consent-check">
                            <input type="checkbox" checked={trainingConsent} onChange={(event) => setTrainingConsent(event.target.checked)} />
                            <span>I confirm this is a disclosed mock interview or training session with participant consent.</span>
                        </label>
                    </div>
                    <button className="relay-primary" disabled={!camera.connected || !trainingConsent} onClick={() => camera.createSession().catch(() => {})}>
                        Create camera link
                    </button>
                </div>
            ) : (
                <>
                    <div className="candidate-link-row">
                        <input aria-label="Candidate camera link" readOnly value={camera.session.link} />
                        <button onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
                        <button className="relay-danger" onClick={camera.endSession}>End</button>
                    </div>
                    <div className="candidate-link-meta">Expires at {formatExpiry(camera.session.expiresAt)}. The first browser to open it claims the session.</div>

                    <div className="candidate-relay-workspace">
                        <div className="candidate-relay-video">
                            <video ref={videoRef} autoPlay playsInline muted />
                            {!camera.candidateStream && <div className="candidate-relay-placeholder">Waiting for candidate video</div>}
                            {camera.candidateStream && (
                                <div className="candidate-video-metrics">{qualityLabel}</div>
                            )}
                        </div>

                        <div className="candidate-relay-controls">
                            <div className="relay-control-group">
                                <span>Candidate microphone</span>
                                <button
                                    className={monitorMicrophone ? 'control-active' : ''}
                                    disabled={!camera.candidateStream}
                                    onClick={() => setMonitorMicrophone((current) => !current)}
                                >
                                    {monitorMicrophone ? 'Monitoring on' : 'Monitoring off'}
                                </button>
                                <small>Use headphones so the call cannot pick up the monitored audio acoustically.</small>
                            </div>

                            <div className="relay-control-group">
                                <span>Audio back to candidate</span>
                                <button
                                    className={camera.relayAudioEnabled ? 'control-active' : ''}
                                    disabled={!camera.candidateStream}
                                    onClick={() => camera.relayAudioEnabled ? camera.stopRelayAudio() : camera.startRelayAudio()}
                                >
                                    {camera.relayAudioEnabled ? 'Call audio on' : 'Send call audio'}
                                </button>
                                <small>Sends the superadmin microphone and meeting-system audio to the candidate browser.</small>
                            </div>

                            <div className="relay-control-group">
                                <span>Zoom / Teams camera</span>
                                <button
                                    className={virtualCamera.running ? 'control-active' : ''}
                                    disabled={!camera.candidateStream || (!virtualCamera.running && !virtualCamera.status?.driverInstalled)}
                                    onClick={() => virtualCamera.running ? virtualCamera.stop() : virtualCamera.start()}
                                >
                                    {virtualCamera.running
                                        ? 'Virtual camera on'
                                        : virtualCamera.status?.driverInstalled ? 'Start virtual camera' : 'Native component required'}
                                </button>
                                <small>{virtualCamera.error || virtualCamera.status?.message || 'Checking the Windows virtual camera component...'}</small>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {camera.error && <div className="candidate-relay-error">{camera.error}</div>}
            <audio ref={microphoneRef} autoPlay playsInline muted={!monitorMicrophone} />
        </section>
    );
}
