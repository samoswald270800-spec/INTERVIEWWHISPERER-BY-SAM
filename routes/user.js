/**
 * User (Candidate) Routes
 * These routes are for candidates to view their own data
 */
import express from 'express';

const router = express.Router();

// Placeholder - will be implemented when user dashboard is built
router.get('/stats', (req, res) => {
  res.json({ message: 'User stats endpoint - coming soon' });
});

export default router;

