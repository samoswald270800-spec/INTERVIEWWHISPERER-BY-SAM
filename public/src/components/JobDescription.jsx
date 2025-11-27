import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './JobDescription.css';

export default function JobDescription({ jd, setJd, onSave }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isSaved, setIsSaved] = useState(false);

    const handleSave = async () => {
        const success = await onSave(jd);
        if (success) {
            setIsSaved(true);
            setTimeout(() => {
                setIsSaved(false);
                setIsOpen(false);
            }, 1500);
        }
    };

    return (
        <div className="jd-anchor">
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className="jd-panel"
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                        <div className="jd-header">
                            <span>Context</span>
                            <span className={`saved-tag ${isSaved ? 'visible' : ''}`}>Saved</span>
                        </div>
                        <textarea
                            id="jd"
                            placeholder="Paste job description..."
                            value={jd}
                            onChange={(e) => setJd(e.target.value)}
                        />
                        <button className="save-btn" onClick={handleSave}>Save Context</button>
                    </motion.div>
                )}
            </AnimatePresence>

            <button className="jd-btn" onClick={() => setIsOpen(!isOpen)} title="Job Context">
                <svg className="icon" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </button>
        </div>
    );
}
