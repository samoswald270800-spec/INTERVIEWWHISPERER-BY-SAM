/**
 * Main Router
 * Combines all route modules
 */

import authRoutes from './auth.js';
import superAdminRoutes from './super-admin.js';
import adminRoutes from './admin.js';
import userRoutes from './user.js';
import interviewRoutes from './interview.js';

export {
  authRoutes,
  superAdminRoutes,
  adminRoutes,
  userRoutes,
  interviewRoutes,
};

export default {
  authRoutes,
  superAdminRoutes,
  adminRoutes,
  userRoutes,
  interviewRoutes,
};

