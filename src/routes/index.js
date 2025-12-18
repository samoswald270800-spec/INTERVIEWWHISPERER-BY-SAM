/**
 * Main Router
 * Combines all route modules
 */

import authRoutes from './auth.js';
import userRoutes from './user.js';
import interviewRoutes from './interview.js';

export {
  authRoutes,
  userRoutes,
  interviewRoutes,
};

export default {
  authRoutes,
  userRoutes,
  interviewRoutes,
};
