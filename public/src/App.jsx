import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from './components/Header';
import HeroBanner from './components/HeroBanner';
import ControlBar from './components/ControlBar';
import JobDescription from './components/JobDescription';
import AudioVisualizer from './components/AudioVisualizer';
import QAList from './components/QAList';
import { useAudioCapture } from './hooks/useAudioCapture';
import { useRealtimeSession } from './hooks/useRealtimeSession';
import './App.css';

function App() {
    const [theme, setTheme] = useState('dark');
    const [mode, setMode] = useState('smart');
    const [jobDescription, setJobDescription] = useState('');
    const [qaList, setQaList] = useState([]);
    const [status, setStatus] = useState('idle');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Audio capture hook
    const {
        isCapturing,
        isMuted,
        audioLevel,
        startCapture,
        stopCapture,
        toggleMute,
    } = useAudioCapture();

    // Realtime session hook
    const {
        isProcessing,
        addToTranscript,
        analyzeScreen,
    } = useRealtimeSession(mode);

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    // Apply mode to document
    useEffect(() => {
        document.documentElement.setAttribute('data-mode', mode);
    }, [mode]);

    // Update status based on states
    useEffect(() => {
        if (isAnalyzing) {
            setStatus('analyzing screen...');
        } else if (isProcessing) {
            setStatus('processing...');
        } else if (isCapturing) {
            setStatus('listening');
        } else {
            setStatus('idle');
        }
    }, [isCapturing, isProcessing, isAnalyzing]);

    const handleStartCapture = async () => {
        try {
            await startCapture();
            setStatus('listening');
        } catch (error) {
            console.error('Failed to start capture:', error);
            alert('Failed to start tab capture. Please ensure you selected a tab and enabled "Share tab audio".');
        }
    };

    const handleStopCapture = () => {
        stopCapture();
        setStatus('idle');
    };

    const handleClearAnswers = () => {
        if (window.confirm('Clear all Q&A pairs?')) {
            setQaList([]);
        }
    };

    const handleSaveJobDescription = async () => {
        try {
            const response = await fetch('/set-jd', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jd: jobDescription }),
            });

            if (response.ok) {
                alert('Job description saved successfully!');
            } else {
                alert('Failed to save job description');
            }
        } catch (error) {
            console.error('Error saving JD:', error);
            alert('Error saving job description');
        }
    };

    const handleAnalyzeScreen = async () => {
        setIsAnalyzing(true);
        try {
            // Capture current tab screenshot
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: 'screen' },
            });

            const track = stream.getVideoTracks()[0];
            const imageCapture = new ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();

            // Convert to base64
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const base64 = canvas.toDataURL('image/png');

            track.stop();
            stream.getTracks().forEach(t => t.stop());

            // Send to backend
            const transcript = qaList.map(qa => `Q: ${qa.q}\nA: ${qa.a}`).join('\n\n');
            const result = await analyzeScreen(base64, transcript);

            if (result) {
                alert(`Screen analyzed successfully!\n\nKey insights extracted and will be used for upcoming answers.`);
            }
        } catch (error) {
            console.error('Error analyzing screen:', error);
            alert('Failed to analyze screen');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    const toggleMode = () => {
        setMode(prev => prev === 'smart' ? 'god' : 'smart');
    };

    return (
        <div className="app">
            <HeroBanner />

            <Header
                theme={theme}
                onToggleTheme={toggleTheme}
                onLogout={handleLogout}
            />

            <ControlBar
                mode={mode}
                onToggleMode={toggleMode}
                isCapturing={isCapturing}
                isMuted={isMuted}
                status={status}
                isProcessing={isProcessing}
                isAnalyzing={isAnalyzing}
                onStartCapture={handleStartCapture}
                onStopCapture={handleStopCapture}
                onToggleMute={toggleMute}
                onClearAnswers={handleClearAnswers}
                onAnalyzeScreen={handleAnalyzeScreen}
            />

            <main className="main-content">
                <JobDescription
                    value={jobDescription}
                    onChange={setJobDescription}
                    onSave={handleSaveJobDescription}
                />

                <AudioVisualizer
                    audioLevel={audioLevel}
                    isCapturing={isCapturing}
                />

                <QAList qaList={qaList} />
            </main>
        </div>
    );
}

export default App;
