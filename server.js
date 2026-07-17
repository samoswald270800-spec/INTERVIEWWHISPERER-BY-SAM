/**
 * Interview Whisperer v2 - Entry Point
 * Multi-Tenant Server with Professional Folder Structure
 * 
 * Supports: Super Admin, Admin (consultancies), Users (candidates)
 * Now with Socket.IO for Remote Control
 */

import http from 'http';
import { createApp } from './src/app.js';
import config from './src/config/index.js';
import { initSocketIO, kickSessions } from './src/lib/socket.js';

async function main() {
  try {
    const app = await createApp();

    // Create HTTP server (needed for Socket.IO)
    const httpServer = http.createServer(app);

    // Reuse the SAME session middleware from Express for Socket.IO
    const sessionMw = app.locals.sessionMiddleware;
    initSocketIO(httpServer, sessionMw);

    // Expose the live-kick helper so login routes can force-logout old devices.
    app.locals.kickSessions = kickSessions;

    httpServer.listen(config.PORT, config.HOST, () => {
      console.log(`✅ Server listening on http://${config.HOST}:${config.PORT}`);
      console.log('   🔌 Socket.IO ready for remote control');
      console.log('   Paste a JD in the UI (Save JD) to tailor answers.');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
