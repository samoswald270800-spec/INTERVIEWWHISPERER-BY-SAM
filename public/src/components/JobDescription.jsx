import React from 'react';
import { motion } from 'framer-motion';
import './JobDescription.css';

const JobDescription = ({ value, onChange, onSave }) => {
    return (
        <motion.div
            className="job-description glass"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
        >
            <div className="jd-header">
                <strong>Job Description</strong>
                <span className="jd-hint">Paste the JD here to tailor your answers</span>
            </div>

            <textarea
                className="jd-textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Paste the job description here..."
                rows={6}
            />

            <div className="jd-footer">
                <button
                    className="glass-btn save-btn"
                    onClick={onSave}
                >
                    Save Job Description
                </button>
                <small className="jd-tip">
                    Tip: Save once; new sessions will auto-use it until you restart the server.
                </small>
            </div>
        </motion.div>
    );
};

export default JobDescription;
