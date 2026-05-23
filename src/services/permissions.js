/**
 * Permission Resolution Service
 * Resolves effective permissions with Super Admin lock hierarchy.
 *
 * Priority: Super Admin User Lock > Super Admin Admin Lock > Admin Setting > Default
 */

const DEFAULT_PERMISSIONS = {
  canExpand: true,
  canAnalyze: true,
  canReasoning: true,
  canTurbo: true,
  canStartSession: true,
};

/**
 * Resolve effective permissions for a USER.
 * @param {object} userPerms - The user's permissions JSONB from DB
 * @param {object} adminPerms - The admin's permissions JSONB from DB
 * @returns {{ permissions: object, lockedFeatures: object }}
 */
export function resolveUserPermissions(userPerms = {}, adminPerms = {}) {
  // Start with defaults, overlay user-level settings (set by admin)
  const base = { ...DEFAULT_PERMISSIONS };
  const { superAdminLocks: userLocks, ...userSettings } = userPerms;
  const { superAdminLocks: adminLocks } = adminPerms;

  // Layer 1: Apply user settings (from admin)
  const effective = { ...base, ...userSettings };

  // Track which features are locked by Super Admin
  const locked = {};

  // Layer 2: Apply admin-level SA locks (cascade to all users under this admin)
  if (adminLocks && typeof adminLocks === 'object') {
    for (const [key, val] of Object.entries(adminLocks)) {
      if (val === false && key in DEFAULT_PERMISSIONS) {
        effective[key] = false;
        locked[key] = 'admin'; // locked at admin level
      }
    }
  }

  // Layer 3: Apply user-level SA locks (override admin locks)
  if (userLocks && typeof userLocks === 'object') {
    for (const [key, val] of Object.entries(userLocks)) {
      if (key in DEFAULT_PERMISSIONS) {
        if (val === false) {
          effective[key] = false;
          locked[key] = 'user'; // locked at user level
        }
        // Note: user-level SA lock set to true does NOT unlock if admin-level is locked.
        // Only removing the SA lock entirely (via PATCH) releases control.
      }
    }
  }

  // Clean superAdminLocks from the returned permissions
  delete effective.superAdminLocks;

  return { permissions: effective, lockedFeatures: locked };
}

/**
 * Resolve effective permissions for an ADMIN.
 * @param {object} adminPerms - The admin's permissions JSONB from DB
 * @returns {{ permissions: object, lockedFeatures: object }}
 */
export function resolveAdminPermissions(adminPerms = {}) {
  const base = { ...DEFAULT_PERMISSIONS };
  const { superAdminLocks: adminLocks, ...adminSettings } = adminPerms;

  const effective = { ...base, ...adminSettings };
  const locked = {};

  if (adminLocks && typeof adminLocks === 'object') {
    for (const [key, val] of Object.entries(adminLocks)) {
      if (val === false && key in DEFAULT_PERMISSIONS) {
        effective[key] = false;
        locked[key] = 'admin';
      }
    }
  }

  delete effective.superAdminLocks;

  return { permissions: effective, lockedFeatures: locked };
}

/**
 * Check if a specific feature is SA-locked for a given set of locks.
 */
export function isFeatureLocked(lockedFeatures, featureKey) {
  return !!lockedFeatures[featureKey];
}

export { DEFAULT_PERMISSIONS };

export default {
  resolveUserPermissions,
  resolveAdminPermissions,
  isFeatureLocked,
  DEFAULT_PERMISSIONS,
};
