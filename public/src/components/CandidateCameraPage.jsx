import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import API_BASE_URL from '../config';
import './CandidateCameraPage.css';

function getGuestId(token) {
    const storageKey = `whisper-camera:${token.slice(0, 16)}`;
    let guestId = sessionStorage.getItem(storageKey);
    if (!guestId) {
        guestId = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
            || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(storageKey, guestId);
    }
    return guestId;
}

export default function CandidateCameraPage({ token }) {
    const [phase, setPhase] = useState('connecting');
    const [status, setStatus] = useState('Checking your secure camera link...');
    const [error, setError] = useState('');
    const [sessionReady, setSessionReady] = useState(null);
    const [cameraEnabled, setCameraEnabled] = useState(true);
    const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
    const [remoteAudioAvailable, setRemoteAudioAvailable] = useState(false);
    const [audioBlocked, setAudioBlocked] = useState(false);

    const videoRef = useRef(null);
    const remoteAudioRef = useRef(null);
    const socketRef = useRef(null);
    const peerRef = useRef(null);
    const localStreamRef = useRef(null);
    const inboundAudioRef = useRef(new MediaStream());
    const pendingIceRef = useRef([]);

    const emitSignal = useCallback((data) => {
        socketRef.current?.emit('camera:signal', { data });
    }, []);

    const closePeer = useCallback(() => {
        if (peerRef.current) {
            try { peerRef.current.close(); } catch { /* already closed */ }
            peerRef.current = null;
        }
        pendingIceRef.current = [];
        inboundAudioRef.current = new MediaStream();
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
        setRemoteAudioAvailable(false);
    }, []);

    const stopLocalMedia = useCallback(() => {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
    }, []);

    const createPeer = useCallback((iceServers) => {
        closePeer();
        const peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
        peer.onicecandidate = ({ candidate }) => {
            if (candidate) emitSignal({ type: 'ice', candidate });
        };
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'connected') {
                setPhase('live');
                setStatus('Your camera is live with the superadmin.');
            } else if (peer.connectionState === 'failed') {
                setError('The media connection failed. Check your network and reopen the link.');
                setPhase('error');
                stopLocalMedia();
            }
        };
        peer.ontrack = ({ track }) => {
            if (track.kind !== 'audio') return;
            const inbound = inboundAudioRef.current;
            if (!inbound.getTracks().some((current) => current.id === track.id)) inbound.addTrack(track);
            setRemoteAudioAvailable(true);
            if (remoteAudioRef.current) {
                remoteAudioRef.current.srcObject = inbound;
                remoteAudioRef.current.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
            }
        };
        peerRef.current = peer;
        return peer;
    }, [closePeer, emitSignal, stopLocalMedia]);

    const handleSignal = useCallback(async (data) => {
        if (!data) return;
        try {
            let peer = peerRef.current;
            if (!peer && data.type === 'offer' && sessionReady) peer = createPeer(sessionReady.iceServers);
            if (!peer) return;

            if (data.type === 'offer') {
                await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                while (pendingIceRef.current.length) {
                    await peer.addIceCandidate(new RTCIceCandidate(pendingIceRef.current.shift()));
                }
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                emitSignal({ type: 'answer', sdp: peer.localDescription });
            } else if (data.type === 'answer') {
                await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                while (pendingIceRef.current.length) {
                    await peer.addIceCandidate(new RTCIceCandidate(pendingIceRef.current.shift()));
                }
            } else if (data.type === 'ice') {
                if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
                else pendingIceRef.current.push(data.candidate);
            }
        } catch (signalError) {
            console.error('[CandidateCamera] signaling error:', signalError);
            setError('The secure media connection could not be negotiated.');
        }
    }, [createPeer, emitSignal, sessionReady]);

    const handleSignalRef = useRef(handleSignal);
    handleSignalRef.current = handleSignal;

    useEffect(() => {
        const baseUrl = API_BASE_URL || window.location.origin;
        const socket = io(`${baseUrl}/camera`, {
            auth: { token, guestId: getGuestId(token) },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1500,
            reconnectionAttempts: 6,
        });
        socketRef.current = socket;

        socket.on('camera:session-ready', (details) => {
            setSessionReady(details);
            setPhase((current) => current === 'live' ? current : 'ready');
            setStatus('Your secure session is ready.');
            setError('');
        });
        socket.on('camera:signal', ({ data }) => handleSignalRef.current(data));
        socket.on('camera:session-error', ({ message }) => {
            setError(message);
            setPhase('error');
        });
        socket.on('camera:session-ended', ({ reason } = {}) => {
            closePeer();
            stopLocalMedia();
            setPhase('ended');
            setStatus(reason === 'expired'
                ? 'This secure camera link expired.'
                : 'The superadmin ended this camera session.');
        });
        socket.on('connect_error', (connectError) => {
            setError(connectError.message || 'This camera link could not be opened.');
            setPhase('error');
        });

        return () => {
            socket.emit('camera:leave');
            socket.disconnect();
            socketRef.current = null;
            closePeer();
            stopLocalMedia();
        };
    }, [token, closePeer, stopLocalMedia]);

    const joinSession = async () => {
        if (!sessionReady || phase === 'requesting') return;
        setPhase('requesting');
        setError('');
        setStatus('Requesting camera and microphone access...');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 60, max: 60 },
                    facingMode: 'user',
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            localStreamRef.current = stream;
            stream.getVideoTracks().forEach((track) => { track.contentHint = 'motion'; });
            stream.getAudioTracks().forEach((track) => { track.contentHint = 'speech'; });
            stream.getVideoTracks().forEach((track) => {
                track.onended = () => {
                    if (!localStreamRef.current) return;
                    setError('Your camera stopped. Reopen the link to start a new secure session.');
                    setPhase('error');
                    socketRef.current?.emit('camera:leave');
                    stopLocalMedia();
                };
            });
            if (videoRef.current) videoRef.current.srcObject = stream;

            const peer = createPeer(sessionReady.iceServers);
            stream.getTracks().forEach((track) => {
                const sender = peer.addTrack(track, stream);
                if (track.kind === 'video') {
                    const parameters = sender.getParameters();
                    parameters.degradationPreference = 'maintain-framerate';
                    if (parameters.encodings?.length) {
                        parameters.encodings[0].maxBitrate = 5_000_000;
                        parameters.encodings[0].maxFramerate = 60;
                        sender.setParameters(parameters).catch((qualityError) => {
                            console.warn('[CandidateCamera] quality tuning unavailable:', qualityError.message);
                        });
                    }
                }
            });
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            emitSignal({ type: 'offer', sdp: peer.localDescription });
            setStatus('Connecting your camera...');
        } catch (mediaError) {
            console.error('[CandidateCamera] media error:', mediaError);
            setError(mediaError.name === 'NotAllowedError'
                ? 'Camera and microphone permission are required for this session.'
                : 'Your camera or microphone could not be started.');
            setPhase('ready');
            stopLocalMedia();
        }
    };

    const toggleCamera = () => {
        const next = !cameraEnabled;
        localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
        setCameraEnabled(next);
    };

    const toggleMicrophone = () => {
        const next = !microphoneEnabled;
        localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
        setMicrophoneEnabled(next);
    };

    const enableRemoteAudio = () => {
        remoteAudioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    };

    const leaveSession = () => {
        socketRef.current?.emit('camera:leave');
        closePeer();
        stopLocalMedia();
        setPhase('ended');
        setStatus('You left the camera session.');
    };

    const isPublishing = phase === 'requesting' || phase === 'live';

    return (
        <main className="candidate-camera-page">
            <header className="candidate-camera-header">
                <div>
                    <div className="candidate-camera-brand">Interview Whisperer</div>
                    <h1>Camera session</h1>
                </div>
                <span className={`candidate-camera-status ${phase}`}>{phase === 'live' ? 'Live' : phase}</span>
            </header>

            <section className="candidate-camera-stage" aria-label="Camera preview">
                <video ref={videoRef} autoPlay playsInline muted />
                {!isPublishing && (
                    <div className="candidate-camera-placeholder">
                        <strong>{phase === 'ended' ? 'Session finished' : 'Camera preview'}</strong>
                        <span>{status}</span>
                    </div>
                )}
                {!cameraEnabled && isPublishing && <div className="candidate-camera-off">Camera is off</div>}
            </section>

            <section className="candidate-camera-controls" aria-label="Session controls">
                {phase === 'ready' && <button className="candidate-primary" onClick={joinSession}>Join camera session</button>}
                {isPublishing && (
                    <>
                        <button className={cameraEnabled ? '' : 'control-off'} onClick={toggleCamera}>
                            {cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                        </button>
                        <button className={microphoneEnabled ? '' : 'control-off'} onClick={toggleMicrophone}>
                            {microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
                        </button>
                        <button className="candidate-danger" onClick={leaveSession}>Leave</button>
                    </>
                )}
                {audioBlocked && remoteAudioAvailable && (
                    <button className="candidate-primary" onClick={enableRemoteAudio}>Hear call audio</button>
                )}
            </section>

            <p className="candidate-camera-note">Your camera and microphone are shared only for this consented session. Leaving stops both immediately.</p>
            {error && <div className="candidate-camera-error" role="alert">{error}</div>}
            <audio ref={remoteAudioRef} autoPlay playsInline />
        </main>
    );
}
