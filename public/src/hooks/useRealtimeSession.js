import { useState, useRef, useCallback } from 'react';

export const useRealtimeSession = (mode) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const sessionRef = useRef(null);
    const wsRef = useRef(null);

    const createSession = useCallback(async () => {
        try {
            const response = await fetch('/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
            });

            if (!response.ok) {
                throw new Error('Failed to create session');
            }

            const session = await response.json();
            sessionRef.current = session;
            return session;
        } catch (error) {
            console.error('Error creating session:', error);
            throw error;
        }
    }, [mode]);

    const connectWebSocket = useCallback(async (session) => {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(session.url);

            ws.addEventListener('open', () => {
                console.log('WebSocket connected');
                wsRef.current = ws;
                resolve(ws);
            });

            ws.addEventListener('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            ws.addEventListener('close', () => {
                console.log('WebSocket closed');
                wsRef.current = null;
            });
        });
    }, []);

    const addToTranscript = useCallback((question, answer) => {
        // This would be called when new Q&A pairs are received
        // Implementation depends on how you want to handle transcript updates
        console.log('Adding to transcript:', { question, answer });
    }, []);

    const analyzeScreen = useCallback(async (screenshotBase64, transcript) => {
        try {
            setIsProcessing(true);

            const response = await fetch('/analyze-screen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    screenshotBase64,
                    sessionTranscript: transcript,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to analyze screen');
            }

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error analyzing screen:', error);
            throw error;
        } finally {
            setIsProcessing(false);
        }
    }, []);

    return {
        isProcessing,
        createSession,
        connectWebSocket,
        addToTranscript,
        analyzeScreen,
    };
};
