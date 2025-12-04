/**
 * User (Candidate) API Routes
 * All routes require user role
 */

import express from 'express';

const router = express.Router();

/**
 * Middleware: Require User
 */
function requireUser(req, res, next) {
  if (req.session?.role !== 'user') {
    return res.status(403).json({ error: 'User access required' });
  }
  next();
}

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
      .select('id, username, email, credits, permissions, status, admins(id, name)')
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
        email: user.email,
        credits: user.credits,
        permissions: user.permissions,
        status: user.status,
        adminName: user.admins?.name,
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

    res.json({ ok: true, credits: user.credits });
  } catch (e) {
    console.error('[User Credits]', e);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

/**
 * GET /api/user/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ ok: true, sessions });
  } catch (e) {
    console.error('[User Sessions]', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /api/user/credit-history
 */
router.get('/credit-history', async (req, res) => {
  try {
    const { supabase } = req.app.locals;
    const userId = req.session.supabaseId;

    const { data: transactions, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ ok: true, transactions });
  } catch (e) {
    console.error('[User Credit History]', e);
    res.status(500).json({ error: 'Failed to fetch credit history' });
  }
});

export default router;
