const path = require('node:path');

// Firebase CLI's MOTD fetch can keep local emulator commands alive offline.
const workspaceRoot = process.env.E2E_FIREBASE_WORKSPACE_DIR || path.resolve(__dirname, '../../..');
const motd = require(path.resolve(workspaceRoot, 'node_modules/firebase-tools/lib/fetchMOTD.js'));
motd.fetchMOTD = () => undefined;
