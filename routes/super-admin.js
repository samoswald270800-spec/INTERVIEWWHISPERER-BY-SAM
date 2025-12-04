/**
 * Super Admin Routes
 * These routes are for the platform owner to manage admins
 */
import express from 'express';

const router = express.Router();

// Placeholder - will be implemented when super admin dashboard is built
router.get('/stats', (req, res) => {
  res.json({ message: 'Super Admin stats endpoint - coming soon' });
});

export default router;

