/**
 * Admin (Consultancy) Routes
 * These routes are for consultancy admins to manage their users
 */
import express from 'express';

const router = express.Router();

// Placeholder - will be implemented when admin dashboard is built
router.get('/stats', (req, res) => {
  res.json({ message: 'Admin stats endpoint - coming soon' });
});

export default router;

