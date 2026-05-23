/**
 * Main Router
 * Combines all route modules
 */

import authRoutes from './auth.js';
import superAdminRoutes from './super-admin.js';
import adminRoutes from './admin.js';
import userRoutes from './user.js';
import interviewRoutes from './interview.js';
import reasoningRoutes from './reasoning.js';

export {
  authRoutes,
  superAdminRoutes,
  adminRoutes,
  userRoutes,
  interviewRoutes,
  reasoningRoutes,
};

export default {
  authRoutes,
  superAdminRoutes,
  adminRoutes,
  userRoutes,
  interviewRoutes,
  reasoningRoutes,
};
