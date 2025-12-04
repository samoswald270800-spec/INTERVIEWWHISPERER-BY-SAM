/**
 * Authentication Middleware
 */

/**
 * Require any authenticated user
 */
export function requireAuth(req, res, next) {
  // Allow login page and login endpoint
  if (req.path === '/login' || req.path === '/api/login') return next();
  
  // Allow auth endpoints (login doesn't require existing session)
  if (req.path.startsWith('/api/auth/')) return next();

  // Debug logging for root
  if (req.path === '/' || req.path === '/index.html') {
    console.log(`[Auth Check] Path: ${req.path}, SessionID: ${req.sessionID}, User: ${req.session?.userId}, Role: ${req.session?.role}`);
  }

  if (req.session?.userId) {
    return next();
  }

  console.log(`[Auth] No session found. Redirecting to /login. (SessionID: ${req.sessionID})`);
  return res.redirect('/login');
}

/**
 * Require Admin role (legacy admin or super_admin)
 */
export function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin' || req.session?.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin only' });
}

/**
 * Require Super Admin role
 */
export function requireSuperAdmin(req, res, next) {
  if (req.session?.role === 'super_admin') {
    return next();
  }
  return res.status(403).json({ error: 'Super Admin only' });
}

/**
 * Require Consultancy Admin role
 */
export function requireConsultancyAdmin(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Consultancy Admin only' });
}

/**
 * Require User role
 */
export function requireUser(req, res, next) {
  if (req.session?.role === 'user') {
    return next();
  }
  return res.status(403).json({ error: 'User only' });
}

export default {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireConsultancyAdmin,
  requireUser,
};

