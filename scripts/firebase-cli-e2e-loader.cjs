const path = require('node:path');

// Firebase CLI's MOTD fetch can keep a local emulator command alive offline.
const motd = require(path.resolve(process.cwd(), 'node_modules/firebase-tools/lib/fetchMOTD.js'));
motd.fetchMOTD = () => undefined;
