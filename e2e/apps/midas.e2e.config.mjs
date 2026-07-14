export default {
  appName: 'midas',
  projectId: 'midas-e2e-local',
  host: '127.0.0.1',
  ports: { auth: 9199, firestore: 8180, app: 4174 },
  firebaseConfigPath: 'firebase.midas.e2e.json',
  artifactDirectories: ['.playwright/midas-e2e', '.firebase/midas-e2e'],
  seedCommand: 'npm run seed:e2e:midas',
  playwrightCommand: 'playwright test -c apps/midas/playwright.authenticated.config.ts',
  verifyCommand: 'node scripts/verify-midas-e2e.mjs',
};
