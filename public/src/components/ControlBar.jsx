import React from 'react';
import { motion } from 'framer-motion';
import './ControlBar.css';

const ControlBar = ({
    mode,
    onToggleMode,
    isCapturing,
    isMuted,
    status,
    isProcessing,
    isAnalyzing,
    onStartCapture,
    onStopCapture,
    onToggleMute,
    onClearAnswers,
    onAnalyzeScreen,
}) => {
    return (
        <motion.div
            className="control-bar glass"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
        >
            {/* Row 1: Action buttons + Mode Switch */}
            <div className="control-row">
                <div className="control-group">
                    <button
                        className="glass-btn"
                        onClick={onStartCapture}
                        disabled={isCapturing}
                    >
                        Start Tab Capture
                    </button>

                    <button
                        className="glass-btn"
                        onClick={onStopCapture}
                        disabled={!isCapturing}
                    >
                        Stop
                    </button>

                    <button
                        className="glass-btn"
                        onClick={onToggleMute}
                        disabled={!isCapturing}
                    >
                        {isMuted ? 'Unmute' : 'Mute'}
                    </button>

                    <button
                        className="glass-btn"
                        onClick={onClearAnswers}
                    >
                        Clear Answers
                    </button>

                    <button
                        className="glass-btn analyze-btn"
                        onClick={onAnalyzeScreen}
                        disabled={isAnalyzing}
                        aria-label="Analyze Screen"
                        title="Analyze the active screen"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round"
                                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                        </svg>
                    </button>
                </div>

                <div className="mode-switch-container">
                    <div className="mode-switch">
                        <div className={`mode-pill ${mode === 'god' ? 'god-mode' : ''}`} />
                        <button
                            className={`mode-btn ${mode === 'smart' ? 'active' : ''}`}
                            onClick={() => onToggleMode()}
                            disabled={isProcessing}
                        >
                            Smart Detail
                        </button>
                        <button
                            className={`mode-btn ${mode === 'god' ? 'active' : ''}`}
                            onClick={() => onToggleMode()}
                            disabled={isProcessing}
                        >
                            GodMode
                        </button>
                    </div>
                    <div className={`mode-status-chip ${mode === 'god' ? 'god-mode' : ''}`}>
                        {mode === 'smart' ? '⚡ Smart' : '🔥 God Mode'}
                    </div>
                </div>
            </div>

            {/* Row 2: Status indicators */}
            <div className="status-row">
                <span className={`status-pill ${isCapturing ? 'active' : ''}`}>
                    listening
                </span>
                <span className={`status-pill ${isProcessing ? 'active' : ''}`}>
                    processing
                </span>
                <div className="status-chip">
                    {status}
                </div>
            </div>
        </motion.div>
    );
};

export default ControlBar;
