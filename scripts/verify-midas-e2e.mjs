import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'midas-e2e-local';
const uid = 'midas-e2e-user';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') {
  throw new Error('La verificación E2E de MIDAS requiere Firestore Emulator en 127.0.0.1:8180.');
}

const app = getApps()[0] ?? initializeApp({ projectId });
const snapshot = await getFirestore(app).doc(`users/${uid}/midas_config/simulationActiveV1`).get();
const data = snapshot.data();
if (!snapshot.exists || !data?.active?.paramsJson || !data?.active?.hash) {
  throw new Error('La configuración canónica de MIDAS no existe en Firestore Emulator.');
}

const reconciled = data.e2eSeedMarker !== 'midas-e2e-seed-v1';
console.log(reconciled
  ? 'MIDAS reconcilió su configuración automáticamente dentro de Firestore Emulator.'
  : 'MIDAS usó la configuración seed sin reconciliación adicional.');
await app.delete();
