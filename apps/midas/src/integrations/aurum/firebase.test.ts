import assert from 'node:assert/strict';
import { detectAurumIntegrationGoogleRedirectMode, shouldSignOutAnonymousBeforeGoogle } from './firebase';

(() => {
  assert.equal(
    detectAurumIntegrationGoogleRedirectMode(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    ),
    true,
  );
})();

(() => {
  assert.equal(
    detectAurumIntegrationGoogleRedirectMode(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    ),
    false,
  );
})();

(() => {
  assert.equal(shouldSignOutAnonymousBeforeGoogle({ isAnonymous: true }), true);
  assert.equal(shouldSignOutAnonymousBeforeGoogle({ isAnonymous: false }), false);
  assert.equal(shouldSignOutAnonymousBeforeGoogle(null), false);
})();

console.log('firebase auth tests passed');
