// src/services/maintenanceLog.ts
// Minimal maintenance action log stored in Firestore.
// Purpose: show "último uso" and help users avoid clicking random one-shot buttons.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const META_COLLECTION = 'meta';
const MAINT_LOG_DOC_ID = 'maintenance_log';

export type MaintenanceLogEntry = {
  key: string;
  title?: string;
  lastAt: string; // ISO
  lastBy?: string;
  lastResult?: 'ok' | 'error' | 'cancelled';
  lastMessage?: string;
};

export type MaintenanceLogDoc = {
  actions?: Record<string, MaintenanceLogEntry>;
};

export async function getMaintenanceLog(): Promise<MaintenanceLogDoc> {
  const ref = doc(db, META_COLLECTION, MAINT_LOG_DOC_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { actions: {} };
  const data = (snap.data() || {}) as MaintenanceLogDoc;
  return { actions: data.actions || {} };
}

export async function markMaintenanceAction(args: {
  key: string;
  title?: string;
  user?: string;
  result: 'ok' | 'error' | 'cancelled';
  message?: string;
}) {
  const ref = doc(db, META_COLLECTION, MAINT_LOG_DOC_ID);
  const entry: MaintenanceLogEntry = {
    key: args.key,
    title: args.title,
    lastAt: new Date().toISOString(),
    lastBy: args.user,
    lastResult: args.result,
    lastMessage: args.message,
  };
  await setDoc(
    ref,
    {
      actions: {
        [args.key]: entry,
      },
    },
    { merge: true },
  );
}
