/**
 * Main Router
 * Combines all route modules
 */

import authRoutes from './auth.js';
import userRoutes from './user.js';
import interviewRoutes from './interview.js';
import reasoningRoutes from './reasoning.js';

export {
  authRoutes,
  userRoutes,
  interviewRoutes,
  reasoningRoutes,
};

export default {
  authRoutes,
  userRoutes,
  interviewRoutes,
  reasoningRoutes,
};
