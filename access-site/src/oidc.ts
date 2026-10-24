/**
 * OpenID Connect provider for Google Workspace's custom OIDC SSO profile.
 *
 * Authorization code flow only, one confidential client (Google), RS256 ID
 * tokens. The subject is the numeric GitHub user ID; the email claim is the
 * Workspace address configured for that GitHub user in users.ts, which is
 * what Google matches on.
 */
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { SignJWT, createLocalJWKSet, jwtVerify, type JWK } from 'jose';
import type { AppEnv, Env } from './env';
import { loadSigningKey, randomToken, timingSafeEqual, verifyPkce } from './crypto';
import {
  pinGithubIdentity,
  saveCode,
  savePending,
  takeCode,
  type PendingAuthorization,
} from './db';
import { workspaceEmailFor } from './eligibility';

export interface GitHubIdentity {
  id: string;
  login: string;
  name: string | null;
}

export const PENDING_COOKIE = '__Host-mcp_pending';
const PENDING_TTL = 600;
const CODE_TTL = 120;
const TOKEN_TTL = 300;

type Ctx = Context<AppEnv>;

function redirectUris(env: Env): string[] {
  return env.OIDC_REDIRECT_URIS.split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

function oauthError(c: Ctx, error: string, description: string, status: 400 | 401 = 400) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, error_description: description }, status);
}

export function discovery(c: Ctx) {
  const iss = c.env.ISSUER;
  return c.json({
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'email', 'email_verified', 'name', 'preferred_username'],
  });
}

async function publicKeys(env: Env): Promise<JWK[]> {
  const keys: JWK[] = [(await loadSigningKey(env.OIDC_SIGNING_KEY)).publicJwk];
  // During rotation, also publish the previous public key. "{}" (or anything
  // that isn't an RSA JWK) means there is none.
  if (env.OIDC_PREVIOUS_JWK) {
    try {
      const previous = JSON.parse(env.OIDC_PREVIOUS_JWK) as JWK;
      if (previous.kty === 'RSA' && previous.n && previous.e && previous.kid) {
        keys.push({
          kty: 'RSA',
          n: previous.n,
          e: previous.e,
          kid: previous.kid,
          alg: 'RS256',
          use: 'sig',
        });
      }
    } catch {
      // ignore a malformed value rather than breaking sign-in
    }
  }
  return keys;
}

export async function jwks(c: Ctx) {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ keys: await publicKeys(c.env) });
}

/** GET /authorize: validate Google's request, park it, and send the user to GitHub. */
export async function authorize(c: Ctx) {
  const q = c.req.query();
  const env = c.env;

  // Never redirect to an unknown client or URI; show an error instead.
  if (q.client_id !== env.OIDC_CLIENT_ID) return c.text('Unknown client_id', 400);
  const redirectUri = q.redirect_uri ?? '';
  if (!redirectUris(env).includes(redirectUri)) return c.text('Unregistered redirect_uri', 400);

  const fail = (error: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (q.state) url.searchParams.set('state', q.state);
    return c.redirect(url.toString());
  };
  if (q.response_type !== 'code') return fail('unsupported_response_type');
  if (!(q.scope ?? '').split(' ').includes('openid')) return fail('invalid_scope');
  if ((q.state?.length ?? 0) > 1024 || (q.nonce?.length ?? 0) > 1024)
    return fail('invalid_request');

  let codeChallenge: string | null = null;
  if (q.code_challenge !== undefined) {
    if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) {
      return fail('invalid_request');
    }
    codeChallenge = q.code_challenge;
  }

  const pending: PendingAuthorization = {
    client_id: q.client_id,
    redirect_uri: redirectUri,
    state: q.state ?? null,
    nonce: q.nonce ?? null,
    code_challenge: codeChallenge,
  };
  const pendingId = randomToken();
  await savePending(env.DB, pendingId, pending, PENDING_TTL);
  setCookie(c, PENDING_COOKIE, pendingId, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: PENDING_TTL,
  });
  return c.redirect('/login');
}

export type AuthorizationResult =
  | { ok: true; location: string }
  | { ok: false; reason: 'no_account' | 'identity_mismatch' };

/**
 * Called after GitHub sign-in when a Google request is pending. Returns the
 * redirect back to Google with a code, or why this GitHub user can't sign in:
 * no Workspace account in users.ts, or a login that is pinned to a different
 * GitHub user ID (a freed and re-registered login).
 */
export async function completeAuthorization(
  env: Env,
  identity: GitHubIdentity,
  pending: PendingAuthorization
): Promise<AuthorizationResult> {
  const email = workspaceEmailFor(identity.login, env.WORKSPACE_DOMAIN);
  if (!email) return { ok: false, reason: 'no_account' };
  if (!(await pinGithubIdentity(env.DB, identity.login, identity.id))) {
    return { ok: false, reason: 'identity_mismatch' };
  }

  const claims = {
    sub: identity.id,
    email,
    email_verified: true,
    name: identity.name || identity.login,
    preferred_username: identity.login,
    auth_time: Math.floor(Date.now() / 1000),
  };
  const code = randomToken();
  await saveCode(
    env.DB,
    code,
    {
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      nonce: pending.nonce,
      code_challenge: pending.code_challenge,
      claims,
    },
    CODE_TTL
  );
  const url = new URL(pending.redirect_uri);
  url.searchParams.set('code', code);
  if (pending.state) url.searchParams.set('state', pending.state);
  return { ok: true, location: url.toString() };
}

/** RFC 6749 section 2.3.1: Basic credentials are form-urlencoded, then base64. */
function formDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '));
}

function clientCredentials(c: Ctx, body: Record<string, unknown>) {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const colon = decoded.indexOf(':');
      if (colon < 0) return { id: '', secret: '' };
      return {
        id: formDecode(decoded.slice(0, colon)),
        secret: formDecode(decoded.slice(colon + 1)),
      };
    } catch {
      return { id: '', secret: '' };
    }
  }
  return {
    id: typeof body.client_id === 'string' ? body.client_id : '',
    secret: typeof body.client_secret === 'string' ? body.client_secret : '',
  };
}

/** POST /token: exchange a single-use code for an ID token. */
export async function token(c: Ctx) {
  const env = c.env;
  const body = (await c.req.parseBody()) as Record<string, unknown>;
  const client = clientCredentials(c, body);
  if (
    !timingSafeEqual(client.id, env.OIDC_CLIENT_ID) ||
    !timingSafeEqual(client.secret, env.OIDC_CLIENT_SECRET)
  ) {
    c.header('WWW-Authenticate', 'Basic realm="token"');
    return oauthError(c, 'invalid_client', 'Client authentication failed', 401);
  }
  if (body.grant_type !== 'authorization_code') {
    return oauthError(c, 'unsupported_grant_type', 'Only authorization_code is supported');
  }
  if (typeof body.code !== 'string') return oauthError(c, 'invalid_request', 'Missing code');

  const code = await takeCode(env.DB, body.code);
  if (!code || code.client_id !== client.id || code.redirect_uri !== body.redirect_uri) {
    return oauthError(c, 'invalid_grant', 'Invalid or expired code');
  }
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
  if (code.code_challenge) {
    if (!(await verifyPkce(verifier, code.code_challenge))) {
      return oauthError(c, 'invalid_grant', 'PKCE verification failed');
    }
  } else if (verifier) {
    // RFC 9700: a verifier without a challenge at /authorize is a downgrade attempt.
    return oauthError(c, 'invalid_grant', 'Unexpected code_verifier');
  }

  const { privateKey, publicJwk } = await loadSigningKey(env.OIDC_SIGNING_KEY);
  const sub = String(code.claims.sub);
  const idToken = await new SignJWT({
    ...code.claims,
    ...(code.nonce ? { nonce: code.nonce } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid, typ: 'JWT' })
    .setIssuer(env.ISSUER)
    .setAudience(client.id)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL}s`)
    .sign(privateKey);
  const accessToken = await new SignJWT({
    ...code.claims,
    client_id: client.id,
    scope: 'openid email profile',
  })
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid, typ: 'at+jwt' })
    .setIssuer(env.ISSUER)
    .setAudience(`${env.ISSUER}/userinfo`)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL}s`)
    .sign(privateKey);

  c.header('Cache-Control', 'no-store');
  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL,
    id_token: idToken,
    scope: 'openid email profile',
  });
}

/** GET|POST /userinfo */
export async function userinfo(c: Ctx) {
  const header = c.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    c.header('WWW-Authenticate', 'Bearer');
    return oauthError(c, 'invalid_token', 'Missing bearer token', 401);
  }
  try {
    const { payload } = await jwtVerify(
      header.slice(7),
      createLocalJWKSet({ keys: await publicKeys(c.env) }),
      { issuer: c.env.ISSUER, audience: `${c.env.ISSUER}/userinfo`, typ: 'at+jwt' }
    );
    c.header('Cache-Control', 'no-store');
    return c.json({
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified,
      name: payload.name,
      preferred_username: payload.preferred_username,
    });
  } catch {
    c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
    return oauthError(c, 'invalid_token', 'Invalid or expired token', 401);
  }
}
