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
      .select('id, username, credits, permissions, status, created_at, admins(id, name, org_code)')
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
        orgCode: user.admins?.org_code || null,
        memberSince: user.created_at || null,
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

// --- HISTORY ROUTES ---

/**
 * GET /history
 * Fetch last 10 interview history items for the user
 */
router.get('/history', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('interview_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({ ok: true, history: data });
  } catch (e) {
    console.error('[History GET] Error:', e);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * POST /history
 * Save a new interview history item.
 * Enforces max 10 items per user (deletes oldest if > 10).
 */
router.post('/history', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;
    const { name, resume_text, jd_text, qa_list, settings } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!name) return res.status(400).json({ error: 'Name is required' });

    // 1. Insert new item
    const { data, error } = await supabase
      .from('interview_history')
      .insert({
        user_id: userId,
        name,
        resume_text,
        jd_text,
        qa_list,
        settings
      })
      .select()
      .single();

    if (error) throw error;

    // 2. Enforce limit (Keep only latest 10)
    const { data: itemsToDelete, error: fetchError } = await supabase
      .from('interview_history')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(10, 100);

    if (!fetchError && itemsToDelete && itemsToDelete.length > 0) {
      const idsToDelete = itemsToDelete.map(i => i.id);
      await supabase.from('interview_history').delete().in('id', idsToDelete);
    }

    res.json({ ok: true, item: data });
  } catch (e) {
    console.error('[History POST] Error:', e);
    res.status(500).json({ error: 'Failed to save history' });
  }
});

/**
 * DELETE /history/:id
 * Delete a specific history item
 */
router.delete('/history/:id', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;
    const { id } = req.params;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('interview_history')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    console.error('[History DELETE] Error:', e);
    res.status(500).json({ error: 'Failed to delete history item' });
  }
});

export default router;

