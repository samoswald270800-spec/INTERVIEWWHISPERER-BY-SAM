/**
 * User (Candidate) API Routes
 * All routes require user role
 * ALL USE USERNAME (not email)
 */

import express from 'express';
import { requireUser } from '../middleware/auth.js';
import {
  getUserCreditHistory,
  getUserSessionHistory,
  getMinimumChargeTokens,
  getScreenAnalysisCost,
} from '../services/credits.js';

const router = express.Router();

router.use(requireUser);

/**
 * GET /api/user/me
 */
router.get('/me', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, credits, permissions, status, admins(id, name)')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        credits: user.credits,
        permissions: user.permissions,
        status: user.status,
        adminName: user.admins?.name,
      },
      creditInfo: {
        minSessionCost: getMinimumChargeTokens(),
        screenAnalysisCost: getScreenAnalysisCost(),
      }
    });
  } catch (e) {
    console.error('[User Me]', e);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

/**
 * GET /api/user/credits
 */
router.get('/credits', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const { data: user, error } = await supabase
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      ok: true,
      credits: user.credits,
      minSessionCost: getMinimumChargeTokens(),
      screenAnalysisCost: getScreenAnalysisCost(),
    });
  } catch (e) {
    console.error('[User Credits]', e);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

/**
 * GET /api/user/credit-history
 */
router.get('/credit-history', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const result = await getUserCreditHistory(supabase, userId, 50);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ ok: true, transactions: result.transactions });
  } catch (e) {
    console.error('[User Credit History]', e);
    res.status(500).json({ error: 'Failed to fetch credit history' });
  }
});

/**
 * GET /api/user/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const result = await getUserSessionHistory(supabase, userId, 50);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ ok: true, sessions: result.sessions });
  } catch (e) {
    console.error('[User Sessions]', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;

