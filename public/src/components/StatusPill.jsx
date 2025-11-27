import React from 'react';
import { motion } from 'framer-motion';
import './StatusPill.css';

export default function StatusPill({ status, isListening, isProcessing }) {
    return (
        <motion.div
            className="status-pill"
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
            <div className={`status-dot ${isListening ? 'active' : ''}`} id="pListening"></div>
            <span className="status-text">{status || "SYSTEM READY"}</span>
            {isProcessing && (
                <div className="status-dot processing" id="pProcessing"></div>
            )}
        </motion.div>
    );
}
