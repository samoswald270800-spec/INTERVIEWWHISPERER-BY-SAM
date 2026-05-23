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
  });

  // Share Express session with Socket.IO
  io.engine.use(sessionMiddleware);

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
