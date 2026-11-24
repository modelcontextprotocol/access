// Generates the Worker's OIDC signing key and the client secret shared with
// Google, and pipes each straight into `wrangler secret put`. Nothing is
// written to disk; the client secret is printed once because Google needs it.
//
//   node scripts/generate-keys.mjs           # set both secrets
//   node scripts/generate-keys.mjs --rotate  # new signing key only; prints the
//                                            # old public JWK to set as OIDC_PREVIOUS_JWK
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function putSecret(name, value) {
  const res = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const rotate = process.argv.includes('--rotate');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
putSecret('OIDC_SIGNING_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());

if (!rotate) {
  const clientSecret = randomBytes(32).toString('base64url');
  putSecret('OIDC_CLIENT_SECRET', clientSecret);
  // Google's SSO profile needs the same value, so show it once.
  console.log(
    `\nOIDC_CLIENT_SECRET (enter this in the Google SSO profile, then clear your terminal):\n${clientSecret}`
  );
} else {
  console.log(
    '\nNew signing key set. Before deploying, copy the previous key from /jwks and set it as\n' +
      'OIDC_PREVIOUS_JWK so tokens signed with it keep verifying; remove it a day later.'
  );
}
