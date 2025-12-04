/**
 * Interview Whisperer v2 - Entry Point
 * Multi-Tenant Server with Professional Folder Structure
 * 
 * Supports: Super Admin, Admin (consultancies), Users (candidates)
 */

import { createApp } from './src/app.js';
import config from './src/config/index.js';

async function main() {
  try {
    const app = await createApp();

    app.listen(config.PORT, config.HOST, () => {
      console.log(`✅ Server listening on http://${config.HOST}:${config.PORT}`);
      console.log('   Paste a JD in the UI (Save JD) to tailor answers.');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
