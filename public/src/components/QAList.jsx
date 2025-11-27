import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './QAList.css';

const QAList = ({ qaList }) => {
    return (
        <div className="qa-list-container">
            <div className="qa-hint">
                <span className="q-label">Q (blue)</span> is what we hear from the meeting tab.{' '}
                <span className="a-label">A (green)</span> is the answer for you to read.
            </div>

            <div className="qa-list">
                <AnimatePresence>
                    {qaList.length === 0 ? (
                        <motion.div
                            className="qa-empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            No Q&A pairs yet. Start tab capture to begin.
                        </motion.div>
                    ) : (
                        qaList.map((qa, index) => (
                            <motion.div
                                key={index}
                                className="qa-card glass"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                            >
                                {qa.q && (
                                    <div className="question">
                                        <div className="qa-label">Question</div>
                                        <div className="qa-content">{qa.q}</div>
                                    </div>
                                )}
                                {qa.a && (
                                    <div className="answer">
                                        <div className="qa-label">Answer</div>
                                        <div className="qa-content">{qa.a}</div>
                                    </div>
                                )}
                            </motion.div>
                        ))
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default QAList;
