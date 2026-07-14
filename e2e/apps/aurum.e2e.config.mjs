export default {
  appName: 'aurum',
  projectId: 'aurum-e2e-local',
  host: '127.0.0.1',
  ports: { auth: 9099, firestore: 8080, app: 3000 },
  artifactDirectories: ['.playwright/aurum-e2e', '.firebase/aurum-e2e'],
  seedCommand: 'npm run seed:e2e:aurum',
  playwrightCommand: 'playwright test -c apps/aurum/playwright.authenticated.config.ts',
};
