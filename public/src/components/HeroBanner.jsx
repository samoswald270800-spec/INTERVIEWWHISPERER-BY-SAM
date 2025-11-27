import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import './HeroBanner.css';

const HeroBanner = () => {
    const [text, setText] = useState('');
    const fullText = 'INTERVIEW WHISPERER';
    const [cursorVisible, setCursorVisible] = useState(true);

    useEffect(() => {
        let index = 0;
        const typingInterval = setInterval(() => {
            if (index <= fullText.length) {
                setText(fullText.slice(0, index));
                index++;
            } else {
                clearInterval(typingInterval);
            }
        }, 100);

        return () => clearInterval(typingInterval);
    }, []);

    useEffect(() => {
        const cursorInterval = setInterval(() => {
            setCursorVisible(prev => !prev);
        }, 500);

        return () => clearInterval(cursorInterval);
    }, []);

    return (
        <motion.div
            className="hero-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
        >
            <div className="hero-content">
                <div className="hero-text-container glass">
                    <span className="hero-text">{text}</span>
                    <span className={`hero-cursor ${cursorVisible ? 'visible' : ''}`}>|</span>
                </div>
            </div>
        </motion.div>
    );
};

export default HeroBanner;
