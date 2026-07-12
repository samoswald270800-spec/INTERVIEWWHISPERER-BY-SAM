/**
 * Socket.IO Server — Remote Control Signaling
 * 
 * Events:
 *   User-side:
 *     - rc:request-help      → User requests help (generates passcode)
 *     - rc:consent-response  → User accepts/rejects connection
 *     - rc:screen-frame      → User sends screen frame data
 *     - rc:end-session       → User ends remote session
 *
 *   Admin-side:
 *     - rc:connect-passcode  → Admin submits passcode to connect
 *     - rc:input-event       → Admin sends mouse/keyboard events
 *     - rc:end-session       → Admin ends remote session
 *
 *   Server → Client:
 *     - rc:passcode           → Send passcode to user
 *     - rc:help-request       → Notify admin of help request
 *     - rc:consent-request    → Ask user for consent
 *     - rc:connected          → Connection established
 *     - rc:screen-frame       → Forward screen frame to admin
 *     - rc:input-event        → Forward input event to user
 *     - rc:session-ended      → Session ended notification
 *     - rc:online-users       → List of online users (for admin)
 *     - rc:error              → Error notification
 */

import { Server } from 'socket.io';
import { createPasscode, verifyPasscode, consumePasscode, getPasscodeForUser, refreshPasscode } from '../services/passcode.js';
import {
  claimCameraSession,
  createCameraSession,
  deleteCameraSessionById,
} from '../services/cameraSession.js';
import { buildIceServers } from '../services/webrtc.js';

// Track connected sockets by role
const onlineUsers = new Map();   // userId -> { socketId, username, adminName }
const onlineAdmins = new Map();  // socketId -> { role, userId }
const activeSessions = new Map(); // sessionKey -> { adminSocketId, userSocketId, userId, startedAt }

/**
 * Initialize Socket.IO on the HTTP server
 * @param {import('http').Server} httpServer
 * @param {import('express-session').SessionMiddleware} sessionMiddleware
 */
export function initSocketIO(httpServer, sessionMiddleware) {
  const io = new Server(httpServer, {
    cors: { origin: '*', credentials: true },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 5e6,  // 5MB — JPEG frames can be 200-500KB
    pingTimeout: 30000,       // 30s — prevents disconnect on slow networks
    pingInterval: 10000,      // 10s heartbeat
  });

  // Share Express session with Socket.IO
  io.engine.use(sessionMiddleware);

  // Guest camera publishing is isolated from remote-control events and uses a
  // token-scoped namespace with its own authorization rules.
  initializeCameraNamespace(io);

  io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session?.userId) {
      socket.disconnect(true);
      return;
    }

    const role = session.role || 'user';
    const userId = session.supabaseId || session.userId;
    const username = session.userId;

    console.log(`[Socket] ${role} connected: ${username} (${socket.id})`);

    // Track by role
    if (role === 'user') {
      onlineUsers.set(userId, { socketId: socket.id, username, adminName: session.adminName || '' });
      broadcastOnlineUsers(io);
    } else if (role === 'super_admin' || role === 'admin') {
      onlineAdmins.set(socket.id, { role, userId: username });
      // Send current online users to this admin
      socket.emit('rc:online-users', getOnlineUsersList());
    }

    // ══════════════════════════════════════
    //  USER EVENTS
    // ══════════════════════════════════════

    // User requests help → generate passcode
    socket.on('rc:request-help', async () => {
      if (role !== 'user') return;
      try {
        const { code, expiresAt } = await createPasscode(userId);
        socket.emit('rc:passcode', { code, expiresAt });

        // Notify all online admins
        for (const [adminSocketId, admin] of onlineAdmins) {
          io.to(adminSocketId).emit('rc:help-request', {
            userId,
            username,
            adminName: session.adminName || '',
          });
        }
      } catch (e) {
        console.error('[Socket] Passcode error:', e);
        socket.emit('rc:error', { message: 'Failed to generate passcode' });
      }
    });

    // User responds to consent request
    socket.on('rc:consent-response', ({ accepted, adminSocketId }) => {
      if (role !== 'user') return;
      if (accepted) {
        const sessionKey = `${adminSocketId}-${socket.id}`;
        activeSessions.set(sessionKey, {
          adminSocketId,
          userSocketId: socket.id,
          userId,
          startedAt: Date.now(),
        });
        io.to(adminSocketId).emit('rc:connected', { userId, username, sessionKey });
        socket.emit('rc:connected', { sessionKey, controlled: true });
        console.log(`[Socket] Remote session started: ${username} <-> admin (${sessionKey})`);
      } else {
        io.to(adminSocketId).emit('rc:consent-denied', { userId, username });
        console.log(`[Socket] User ${username} denied remote control`);
      }
    });

    // User sends screen frame
    socket.on('rc:screen-frame', ({ sessionKey, frame }) => {
      if (role !== 'user') return;
      const rcSession = activeSessions.get(sessionKey);
      if (rcSession) {
        io.to(rcSession.adminSocketId).emit('rc:screen-frame', { frame });
      }
    });

    // ══════════════════════════════════════
    //  ADMIN EVENTS
    // ══════════════════════════════════════

    // Admin connects with passcode
    socket.on('rc:connect-passcode', async ({ code }) => {
      if (role !== 'super_admin' && role !== 'admin') return;
      try {
        const result = await verifyPasscode(code);
        if (!result.valid) {
          socket.emit('rc:error', { message: 'Invalid or expired passcode' });
          return;
        }

        const userInfo = onlineUsers.get(result.userId);
        if (!userInfo) {
          socket.emit('rc:error', { message: 'User is not online' });
          return;
        }

        // Consume passcode (one-time use)
        await consumePasscode(code);

        // Send consent request to user
        io.to(userInfo.socketId).emit('rc:consent-request', {
          adminSocketId: socket.id,
          adminName: role === 'super_admin' ? 'Super Admin' : username,
        });

        socket.emit('rc:waiting-consent', { username: userInfo.username });
        console.log(`[Socket] Admin requesting control of ${userInfo.username} via passcode`);
      } catch (e) {
        console.error('[Socket] Connect error:', e);
        socket.emit('rc:error', { message: 'Connection failed' });
      }
    });

    // Admin sends input event (mouse/keyboard)
    socket.on('rc:input-event', ({ sessionKey, event }) => {
      if (role !== 'super_admin' && role !== 'admin') return;
      const sess = activeSessions.get(sessionKey);
      if (sess) {
        io.to(sess.userSocketId).emit('rc:input-event', { event });
      }
    });

    // ══════════════════════════════════════
    //  WEBRTC SIGNALING (primary video path)
    //  Server only forwards SDP/ICE between the two
    //  peers — the actual video stream is peer-to-peer.
    // ══════════════════════════════════════
    socket.on('rc:webrtc-signal', ({ sessionKey, data }) => {
      const sess = activeSessions.get(sessionKey);
      if (!sess) return;
      // Only the two participants of this session may exchange signals
      if (socket.id !== sess.adminSocketId && socket.id !== sess.userSocketId) return;
      const targetSocketId = socket.id === sess.adminSocketId ? sess.userSocketId : sess.adminSocketId;
      io.to(targetSocketId).emit('rc:webrtc-signal', { sessionKey, data });
    });

    // ══════════════════════════════════════
    //  SHARED EVENTS
    // ══════════════════════════════════════

    // Either side ends session
    socket.on('rc:end-session', ({ sessionKey }) => {
      const sess = activeSessions.get(sessionKey);
      if (sess) {
        io.to(sess.adminSocketId).emit('rc:session-ended', { reason: 'ended' });
        io.to(sess.userSocketId).emit('rc:session-ended', { reason: 'ended' });
        activeSessions.delete(sessionKey);
        console.log(`[Socket] Remote session ended: ${sessionKey}`);
      }
    });

    // Refresh passcode
    socket.on('rc:refresh-passcode', async () => {
      if (role !== 'user') return;
      try {
        const { code, expiresAt } = await refreshPasscode(userId);
        socket.emit('rc:passcode', { code, expiresAt });
      } catch (e) {
        socket.emit('rc:error', { message: 'Failed to refresh passcode' });
      }
    });

    // Get current passcode
    socket.on('rc:get-passcode', async () => {
      if (role !== 'user') return;
      const code = await getPasscodeForUser(userId);
      if (code) {
        socket.emit('rc:passcode', { code, expiresAt: null });
      }
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      console.log(`[Socket] ${role} disconnected: ${username} (${socket.id})`);

      if (role === 'user') {
        onlineUsers.delete(userId);
        broadcastOnlineUsers(io);
        // End any active sessions this user was in
        for (const [key, sess] of activeSessions) {
          if (sess.userSocketId === socket.id) {
            io.to(sess.adminSocketId).emit('rc:session-ended', { reason: 'user_disconnected' });
            activeSessions.delete(key);
          }
        }
      } else {
        onlineAdmins.delete(socket.id);
        // End any active sessions this admin was in
        for (const [key, sess] of activeSessions) {
          if (sess.adminSocketId === socket.id) {
            io.to(sess.userSocketId).emit('rc:session-ended', { reason: 'admin_disconnected' });
            activeSessions.delete(key);
          }
        }
      }
    });
  });

  console.log('🔌 Socket.IO initialized for remote control');
  return io;
}

function initializeCameraNamespace(io) {
  const candidateReconnectGraceMs = 15_000;
  const camera = io.of('/camera');
  const activeCameraSessions = new Map();
  const adminSessionIds = new Map();
  const adminUserSessions = new Map();

  camera.use(async (socket, next) => {
    const session = socket.request.session;
    if (session?.userId && session.role === 'super_admin') {
      socket.data.cameraRole = 'admin';
      socket.data.adminUserId = session.userId;
      return next();
    }

    try {
      const { token, guestId } = socket.handshake.auth || {};
      const claim = await claimCameraSession(token, guestId);
      if (!claim.ok) {
        const messages = {
          claimed: 'This camera link has already been claimed in another browser.',
          expired: 'This camera link is invalid or has expired.',
          invalid_guest: 'This browser could not establish a camera identity.',
        };
        return next(new Error(messages[claim.reason] || 'Camera session authorization failed.'));
      }

      socket.data.cameraRole = 'candidate';
      socket.data.cameraSession = claim.session;
      return next();
    } catch (error) {
      console.error('[Camera] Authorization failed:', error.message);
      return next(new Error('Camera session authorization failed.'));
    }
  });

  camera.on('connection', (socket) => {
    if (socket.data.cameraRole === 'candidate') {
      registerCandidateCameraSocket(socket);
      return;
    }

    registerAdminCameraSocket(socket);
  });

  function trackActiveCameraSession(active) {
    const delay = Math.max(0, active.expiresAt - Date.now());
    active.expiryTimer = setTimeout(() => {
      endCameraSession(active.id, 'expired').catch(() => {});
    }, delay);
    activeCameraSessions.set(active.id, active);
  }

  function registerCandidateCameraSocket(socket) {
    const persisted = socket.data.cameraSession;
    let active = activeCameraSessions.get(persisted.id);
    if (!active) {
      active = {
        id: persisted.id,
        adminUserId: persisted.adminUserId,
        adminSocketId: persisted.adminSocketId,
        expiresAt: persisted.expiresAt,
        candidateSocketId: null,
      };
      trackActiveCameraSession(active);
    }

    const adminSocket = camera.sockets.get(active.adminSocketId);
    if (!adminSocket || adminSocket.data.cameraRole !== 'admin') {
      socket.emit('camera:session-error', { message: 'The superadmin is no longer connected.' });
      setTimeout(() => socket.disconnect(true), 100);
      return;
    }

    const currentCandidate = active.candidateSocketId && camera.sockets.get(active.candidateSocketId);
    if (currentCandidate && currentCandidate.id !== socket.id) {
      socket.emit('camera:session-error', { message: 'The candidate camera is already connected.' });
      setTimeout(() => socket.disconnect(true), 100);
      return;
    }

    if (active.disconnectTimer) clearTimeout(active.disconnectTimer);
    active.disconnectTimer = null;
    active.candidateSocketId = socket.id;
    socket.join(active.id);
    adminSocket.join(active.id);

    socket.emit('camera:session-ready', {
      sessionId: active.id,
      expiresAt: active.expiresAt,
      iceServers: buildIceServers(),
    });
    adminSocket.emit('camera:candidate-joined', {
      sessionId: active.id,
      expiresAt: active.expiresAt,
    });

    socket.on('camera:signal', ({ data } = {}) => {
      if (!data || active.candidateSocketId !== socket.id) return;
      camera.to(active.adminSocketId).emit('camera:signal', { sessionId: active.id, data });
    });

    socket.on('camera:leave', () => {
      const current = activeCameraSessions.get(active.id);
      if (!current || current.candidateSocketId !== socket.id) return socket.disconnect(true);
      endCameraSession(current.id, 'candidate_left').catch(() => socket.disconnect(true));
    });

    socket.on('disconnect', () => {
      const current = activeCameraSessions.get(active.id);
      if (!current || current.candidateSocketId !== socket.id) return;
      current.candidateSocketId = null;
      camera.to(current.adminSocketId).emit('camera:candidate-left', { sessionId: current.id });
      current.disconnectTimer = setTimeout(() => {
        endCameraSession(current.id, 'candidate_disconnected').catch(() => {});
      }, candidateReconnectGraceMs);
    });
  }

  function registerAdminCameraSocket(socket) {
    socket.on('camera:create-session', async (_payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
      try {
        const previousId = adminUserSessions.get(socket.data.adminUserId) || adminSessionIds.get(socket.id);
        if (previousId) await endCameraSession(previousId, 'replaced');

        const created = await createCameraSession({
          adminUserId: socket.data.adminUserId,
          adminSocketId: socket.id,
        });
        const active = {
          id: created.id,
          adminUserId: created.adminUserId,
          adminSocketId: socket.id,
          expiresAt: created.expiresAt,
          candidateSocketId: null,
        };
        trackActiveCameraSession(active);
        adminSessionIds.set(socket.id, created.id);
        adminUserSessions.set(created.adminUserId, created.id);
        socket.join(created.id);

        ack({
          ok: true,
          sessionId: created.id,
          token: created.token,
          expiresAt: created.expiresAt,
          iceServers: buildIceServers(),
        });
      } catch (error) {
        console.error('[Camera] Failed to create session:', error.message);
        ack({ ok: false, error: 'Failed to create camera session.' });
      }
    });

    socket.on('camera:signal', ({ sessionId, data } = {}) => {
      const active = activeCameraSessions.get(sessionId);
      if (!active || active.adminSocketId !== socket.id || !active.candidateSocketId || !data) return;
      camera.to(active.candidateSocketId).emit('camera:signal', { sessionId, data });
    });

    socket.on('camera:end-session', async ({ sessionId } = {}, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
      const active = activeCameraSessions.get(sessionId);
      if (!active || active.adminSocketId !== socket.id) return ack({ ok: false });
      await endCameraSession(sessionId, 'ended');
      ack({ ok: true });
    });

    socket.on('disconnect', () => {
      const sessionId = adminSessionIds.get(socket.id);
      if (sessionId) endCameraSession(sessionId, 'admin_disconnected').catch(() => {});
    });
  }

  async function endCameraSession(sessionId, reason) {
    const active = activeCameraSessions.get(sessionId);
    if (!active) return;

    if (active.expiryTimer) clearTimeout(active.expiryTimer);
    if (active.disconnectTimer) clearTimeout(active.disconnectTimer);
    activeCameraSessions.delete(sessionId);
    adminSessionIds.delete(active.adminSocketId);
    if (adminUserSessions.get(active.adminUserId) === sessionId) {
      adminUserSessions.delete(active.adminUserId);
    }
    camera.to(sessionId).emit('camera:session-ended', { sessionId, reason });

    const candidateSocket = active.candidateSocketId && camera.sockets.get(active.candidateSocketId);
    if (candidateSocket) candidateSocket.disconnect(true);
    await deleteCameraSessionById(sessionId);
  }
}

function getOnlineUsersList() {
  return Array.from(onlineUsers.entries()).map(([id, info]) => ({
    userId: id,
    username: info.username,
    adminName: info.adminName,
  }));
}

function broadcastOnlineUsers(io) {
  const list = getOnlineUsersList();
  for (const [adminSocketId] of onlineAdmins) {
    io.to(adminSocketId).emit('rc:online-users', list);
  }
}
