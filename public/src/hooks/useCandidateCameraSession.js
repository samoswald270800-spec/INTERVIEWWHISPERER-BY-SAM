import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import API_BASE_URL from '../config';

function cameraLinkForToken(token) {
    const baseUrl = API_BASE_URL || window.location.origin;
    return new URL(`/camera/${token}`, baseUrl).toString();
}

export default function useCandidateCameraSession() {
    const [connected, setConnected] = useState(false);
    const [session, setSession] = useState(null);
    const [candidateState, setCandidateState] = useState('idle');
    const [candidateStream, setCandidateStream] = useState(null);
    const [webrtcState, setWebrtcState] = useState('new');
    const [quality, setQuality] = useState(null);
    const [relayAudioEnabled, setRelayAudioEnabled] = useState(false);
    const [error, setError] = useState('');

    const socketRef = useRef(null);
    const peerRef = useRef(null);
    const sessionRef = useRef(null);
    const pendingIceRef = useRef([]);
    const adminMicRef = useRef(null);
    const systemAudioRef = useRef(null);
    const statsTimerRef = useRef(null);
    const previousVideoStatsRef = useRef(null);

    useEffect(() => { sessionRef.current = session; }, [session]);

    const emitSignal = useCallback((data) => {
        const sessionId = sessionRef.current?.sessionId;
        if (sessionId) socketRef.current?.emit('camera:signal', { sessionId, data });
    }, []);

    const closePeer = useCallback(() => {
        if (statsTimerRef.current) clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
        previousVideoStatsRef.current = null;
        if (peerRef.current) {
            try { peerRef.current.close(); } catch { /* already closed */ }
            peerRef.current = null;
        }
        pendingIceRef.current = [];
        setCandidateStream(null);
        setWebrtcState('new');
        setQuality(null);
    }, []);

    const stopRelayAudio = useCallback(async (renegotiate = true) => {
        const peer = peerRef.current;
        const outgoingTracks = new Set([
            ...(adminMicRef.current?.getTracks() || []),
            ...(systemAudioRef.current?.getTracks() || []),
        ]);

        if (peer) {
            peer.getSenders().forEach((sender) => {
                if (sender.track && outgoingTracks.has(sender.track)) peer.removeTrack(sender);
            });
        }

        adminMicRef.current?.getTracks().forEach((track) => track.stop());
        systemAudioRef.current?.getTracks().forEach((track) => track.stop());
        adminMicRef.current = null;
        systemAudioRef.current = null;
        setRelayAudioEnabled(false);

        if (renegotiate && peer?.remoteDescription && peer.signalingState === 'stable') {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            emitSignal({ type: 'offer', sdp: peer.localDescription });
        }
    }, [emitSignal]);

    const addRelayTracks = useCallback((peer) => {
        const existingTrackIds = new Set(peer.getSenders().map((sender) => sender.track?.id).filter(Boolean));
        for (const stream of [adminMicRef.current, systemAudioRef.current]) {
            stream?.getAudioTracks().forEach((track) => {
                if (!existingTrackIds.has(track.id)) peer.addTrack(track, stream);
            });
        }
    }, []);

    const createPeer = useCallback(() => {
        closePeer();
        const peer = new RTCPeerConnection({
            iceServers: sessionRef.current?.iceServers || [],
            bundlePolicy: 'max-bundle',
            iceCandidatePoolSize: 4,
        });
        addRelayTracks(peer);

        peer.onicecandidate = ({ candidate }) => {
            if (candidate) emitSignal({ type: 'ice', candidate });
        };
        peer.ontrack = ({ track, streams }) => {
            if (track.kind !== 'video' && track.kind !== 'audio') return;
            const inbound = streams?.[0] || new MediaStream([track]);
            setCandidateStream(inbound);
            if (track.kind === 'video') {
                const boundSessionId = sessionRef.current?.sessionId;
                track.onended = () => {
                    if (sessionRef.current?.sessionId !== boundSessionId) return;
                    setCandidateStream(null);
                    setCandidateState('waiting');
                };
            }
        };
        peer.onconnectionstatechange = () => {
            setWebrtcState(peer.connectionState);
            if (peer.connectionState === 'connected') {
                setCandidateState('live');
                if (!statsTimerRef.current) {
                    statsTimerRef.current = setInterval(async () => {
                        try {
                            const reports = await peer.getStats();
                            let inboundVideo = null;
                            reports.forEach((report) => {
                                if (report.type === 'inbound-rtp' && report.kind === 'video' && !report.isRemote) inboundVideo = report;
                            });
                            if (!inboundVideo) return;

                            const previous = previousVideoStatsRef.current;
                            let megabitsPerSecond = null;
                            if (previous && inboundVideo.timestamp > previous.timestamp) {
                                const bits = (inboundVideo.bytesReceived - previous.bytesReceived) * 8;
                                const seconds = (inboundVideo.timestamp - previous.timestamp) / 1000;
                                megabitsPerSecond = Math.max(0, bits / seconds / 1_000_000);
                            }
                            previousVideoStatsRef.current = {
                                bytesReceived: inboundVideo.bytesReceived,
                                timestamp: inboundVideo.timestamp,
                            };
                            setQuality({
                                width: inboundVideo.frameWidth || 0,
                                height: inboundVideo.frameHeight || 0,
                                fps: Math.round(inboundVideo.framesPerSecond || 0),
                                mbps: megabitsPerSecond,
                                jitterMs: Math.round((inboundVideo.jitter || 0) * 1000),
                                packetsLost: inboundVideo.packetsLost || 0,
                            });
                        } catch { /* peer closed between timer ticks */ }
                    }, 1000);
                }
            }
            if (peer.connectionState === 'failed') {
                setCandidateState('failed');
                setError('Candidate media connection failed. Create a new link and try again.');
            }
        };

        peerRef.current = peer;
        return peer;
    }, [addRelayTracks, closePeer, emitSignal]);

    const handleSignal = useCallback(async (data) => {
        if (!data) return;
        try {
            let peer = peerRef.current;
            if (data.type === 'offer') {
                if (!peer || peer.signalingState === 'closed') peer = createPeer();
                await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                while (pendingIceRef.current.length) {
                    await peer.addIceCandidate(new RTCIceCandidate(pendingIceRef.current.shift()));
                }
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                emitSignal({ type: 'answer', sdp: peer.localDescription });
            } else if (data.type === 'answer' && peer) {
                await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
                while (pendingIceRef.current.length) {
                    await peer.addIceCandidate(new RTCIceCandidate(pendingIceRef.current.shift()));
                }
            } else if (data.type === 'ice') {
                if (peer?.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
                else pendingIceRef.current.push(data.candidate);
            }
        } catch (signalError) {
            console.error('[AdminCamera] signaling error:', signalError);
            setError('Candidate media negotiation failed.');
        }
    }, [createPeer, emitSignal]);

    const handleSignalRef = useRef(handleSignal);
    handleSignalRef.current = handleSignal;

    useEffect(() => {
        const baseUrl = API_BASE_URL || window.location.origin;
        const socket = io(`${baseUrl}/camera`, {
            withCredentials: true,
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1500,
            reconnectionAttempts: 10,
        });
        socketRef.current = socket;

        socket.on('connect', () => { setConnected(true); setError(''); });
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', (connectError) => setError(connectError.message || 'Camera service connection failed.'));
        socket.on('camera:candidate-joined', ({ sessionId }) => {
            if (sessionRef.current?.sessionId !== sessionId) return;
            setCandidateState('connecting');
        });
        socket.on('camera:candidate-left', ({ sessionId }) => {
            if (sessionRef.current?.sessionId !== sessionId) return;
            closePeer();
            stopRelayAudio(false).catch(() => {});
            setCandidateState('waiting');
        });
        socket.on('camera:signal', ({ sessionId, data }) => {
            if (sessionRef.current?.sessionId === sessionId) handleSignalRef.current(data);
        });
        socket.on('camera:session-ended', ({ sessionId }) => {
            if (sessionRef.current?.sessionId !== sessionId) return;
            closePeer();
            stopRelayAudio(false).catch(() => {});
            setSession(null);
            setCandidateState('idle');
        });

        return () => {
            socket.disconnect();
            socketRef.current = null;
            closePeer();
            stopRelayAudio(false).catch(() => {});
        };
    }, [closePeer, stopRelayAudio]);

    const createSession = useCallback(() => new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
            reject(new Error('Camera service is still connecting.'));
            return;
        }

        closePeer();
        stopRelayAudio(false).catch(() => {});
        setCandidateState('waiting');
        setError('');

        socket.timeout(8000).emit('camera:create-session', {}, (timeoutError, response) => {
            if (timeoutError || !response?.ok) {
                const createError = new Error(response?.error || 'Camera link could not be created.');
                setError(createError.message);
                setCandidateState('idle');
                reject(createError);
                return;
            }

            const nextSession = {
                sessionId: response.sessionId,
                link: cameraLinkForToken(response.token),
                expiresAt: response.expiresAt,
                iceServers: response.iceServers,
            };
            sessionRef.current = nextSession;
            setSession(nextSession);
            resolve(nextSession);
        });
    }), [closePeer, stopRelayAudio]);

    const endSession = useCallback(() => {
        const current = sessionRef.current;
        if (current) socketRef.current?.emit('camera:end-session', { sessionId: current.sessionId });
        closePeer();
        stopRelayAudio(false).catch(() => {});
        sessionRef.current = null;
        setSession(null);
        setCandidateState('idle');
    }, [closePeer, stopRelayAudio]);

    const startRelayAudio = useCallback(async () => {
        if (relayAudioEnabled) return;
        setError('');
        let microphoneStream = null;
        let displayStream = null;

        try {
            microphoneStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 1 } },
                audio: true,
            });

            if (!displayStream.getAudioTracks().length) {
                throw new Error('System audio was not available. Open this control in the Windows desktop app.');
            }

            microphoneStream.getAudioTracks().forEach((track) => { track.contentHint = 'speech'; });
            displayStream.getAudioTracks().forEach((track) => { track.contentHint = 'music'; });
            displayStream.getVideoTracks().forEach((track) => { track.enabled = false; });
            adminMicRef.current = microphoneStream;
            systemAudioRef.current = displayStream;
            setRelayAudioEnabled(true);
            const handleSystemAudioEnded = () => {
                if (systemAudioRef.current === displayStream) stopRelayAudio(false).catch(() => {});
            };
            displayStream.getTracks().forEach((track) => { track.onended = handleSystemAudioEnded; });

            const peer = peerRef.current;
            if (peer) {
                addRelayTracks(peer);
                if (peer.remoteDescription && peer.signalingState === 'stable') {
                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    emitSignal({ type: 'offer', sdp: peer.localDescription });
                }
            }
        } catch (audioError) {
            microphoneStream?.getTracks().forEach((track) => track.stop());
            displayStream?.getTracks().forEach((track) => track.stop());
            adminMicRef.current = null;
            systemAudioRef.current = null;
            setRelayAudioEnabled(false);
            setError(audioError.message || 'Call audio relay could not be started.');
        }
    }, [addRelayTracks, emitSignal, relayAudioEnabled, stopRelayAudio]);

    return {
        connected,
        session,
        candidateState,
        candidateStream,
        webrtcState,
        quality,
        relayAudioEnabled,
        error,
        createSession,
        endSession,
        startRelayAudio,
        stopRelayAudio,
    };
}
