import { runFirebaseCli } from '../packages/e2e-harness/runtime/firebase-cli.mjs';
process.exitCode = await runFirebaseCli(['emulators:exec', '--project', 'aurum-e2e-local', '--only', 'auth,firestore', 'node scripts/test-midas-publication-emulator.mjs'], process.cwd());
