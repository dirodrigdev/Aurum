const path = require('node:path');

// Firebase CLI's MOTD fetch can keep a local emulator command alive offline.
const repositoryRoot = path.resolve(__dirname, '..');
const motd = require(path.resolve(repositoryRoot, 'node_modules/firebase-tools/lib/fetchMOTD.js'));
motd.fetchMOTD = () => undefined;
