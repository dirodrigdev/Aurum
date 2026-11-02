# GastApp retroactive revisions in Aurum

## Root cause and correction

The automatic certified-revision path compared contract hashes and archived revisions for `gastappExpenseClose` embedded in a wealth closure, but skipped closures whose effective GastApp snapshot lived in `gastapp_snapshots/historical_v1`. The revision inbox also read only closure `previousVersions`, so sidecar corrections neither updated historical returns nor produced notices.

The same reconciliation now handles both snapshot locations. Sidecar updates use a Firestore transaction that reads the wealth root and sidecar, verifies the unique closure identity, verifies that no embedded snapshot has become authoritative, and compares the stored and candidate contract hashes. It archives the prior snapshot and provenance before applying the candidate. A repeated hash/amount is a no-op; a conflicting hash or same hash with a different amount fails closed. Only the sidecar document is written on that path. Closure summary, records, FX rates and patrimonial variation remain untouched.

The read-only audit compares GastApp's current certified contract hash and amount against both embedded and sidecar snapshots, returning `current`, `stale`, `missing` or `blocked`. It reads the root and sidecar documents directly; it does not scan historical movements.

## Production write gate

`VITE_GASTAPP_REVISION_AUTO_SYNC` is an explicit opt-in. If it is unset or anything other than the string `true`, automatic reconciliation performs the read-only audit and returns without calling either closure or sidecar writers. The production Vite build was checked with this variable unset. The tracked `.env.e2e` sets it to `true` only for local emulator scenarios that exercise writes. No production deployment or Firestore write was made for this change.

Before a future first production synchronization:

1. Deploy with `VITE_GASTAPP_REVISION_AUTO_SYNC` unset and inspect the read-only audit summary in Analysis.
2. Review all stale, missing and blocked months against their closure/sidecar identities and certified GastApp contracts.
3. Authorize the intended corrections and only then set the variable to `true` for the approved deployment.

## Validation baseline

Both full unit runs used the same Node 22/Vitest workspace and the same local dependency tree.

| Suite | `origin/main` 6be0c36 | Change |
| --- | ---: | ---: |
| Unit tests | 610 passed, 19 failed | 623 passed, 19 failed |
| Authenticated emulator E2E | 5 passed, 24 failed | 23 passed, 6 failed |

The unit failure names match exactly between baseline and solution. They are confined to `analysis-returns-toolbar.test.ts` (3), `financial-performance-read-error.test.ts` (4), `returns-tab-toggle.test.ts` (1), `sync-status-section.test.ts` (1), and `services/financialPerformance.test.ts` (10). No new failures were introduced.

The 18 E2E failures removed from the full run were caused by the existing Google Fonts network requests. The page now uses the already bundled Inter font and has no Google Fonts links; the shared network guard remains unchanged and enabled. The six remaining failures are all present in the baseline: analysis default copy, analysis mobile hit-area size, revision notice capitalization, the legacy missing-snapshot label, and two responsive close flows (mobile/tablet).

The sidecar no-write/reload E2E passes. A new authenticated emulator E2E also passes against the real Firestore transaction: first correction writes and archives the prior version, root financial fields and FX stay byte-for-byte equivalent in the checked fields, the sidecar snapshot retains its FX rates, and a second call with the same contract hash leaves the document update time and history unchanged.

`npm run build:aurum`, `npm -w apps/aurum run lint -- --no-cache`, 64 focused unit tests, and the targeted sidecar transaction E2E pass.
