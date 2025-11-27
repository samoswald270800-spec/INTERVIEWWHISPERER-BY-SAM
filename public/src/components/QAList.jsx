import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './QAList.css';

export default function QAList({ qaList }) {
    const listRef = useRef(null);

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [qaList]);

    return (
        <div className="stream" ref={listRef} id="list">
            {qaList.length === 0 ? (
                <motion.div
                    className="empty-hero"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                >
                    <h1>Interview Whisperer</h1>
                    <p>Advanced Intelligence System. Initialize session below.</p>
                </motion.div>
            ) : (
                <AnimatePresence>
                    {qaList.map((qa, index) => (
                        <motion.div
                            key={index}
                            className="turn"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <div className="shard q">
                                <div className="meta">
                                    <svg className="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                    INTERVIEWER
                                </div>
                                <div className="text">{qa.question}</div>
                            </div>

                            <div className="shard a">
                                <div className="meta">
                                    <svg className="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                    SUGGESTED ANSWER
                                </div>
                                <div className="text">
                                    {qa.answer}
                                    {index === qaList.length - 1 && <span className="cursor-blink"></span>}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            )}
        </div>
    );
}
