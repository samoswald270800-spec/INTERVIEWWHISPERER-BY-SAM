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
import { initSocketIO } from './src/lib/socket.js';
import { createSessionMiddleware } from './src/middleware/session.js';

async function main() {
  try {
    const app = await createApp();

    // Create HTTP server (needed for Socket.IO)
    const httpServer = http.createServer(app);

    // Share the session middleware with Socket.IO
    const sessionMw = createSessionMiddleware();
    initSocketIO(httpServer, sessionMw);

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
