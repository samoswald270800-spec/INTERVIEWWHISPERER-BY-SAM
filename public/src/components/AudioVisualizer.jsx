import React from 'react';
import { motion } from 'framer-motion';
import './AudioVisualizer.css';

const AudioVisualizer = ({ audioLevel, isCapturing }) => {
    return (
        <motion.div
            className="audio-visualizer glass"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
        >
            <div className="visualizer-content">
                <div className="vu-meter">
                    <div className="vu-bar-container">
                        <motion.div
                            className="vu-bar"
                            animate={{ width: `${audioLevel}%` }}
                            transition={{ duration: 0.1 }}
                        />
                    </div>
                </div>
                <div className="visualizer-hint">
                    Pick your Meet/Zoom/Teams tab and enable <strong>Share tab audio</strong>.
                </div>
            </div>
        </motion.div>
    );
};

export default AudioVisualizer;
