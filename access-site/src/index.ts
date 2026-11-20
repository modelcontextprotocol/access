import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Env } from './env';
import { takePending } from './db';
import { timingSafeEqual } from './crypto';
import {
  exchangeGitHubCode,
  githubAuthorizeUrl,
  githubState,
  readGitHubIdentity,
  revokeGitHubToken,
} from './github';
import {
  authorize,
  completeAuthorization,
  discovery,
  jwks,
  PENDING_COOKIE,
  token,
  userinfo,
} from './oidc';
import * as pages from './pages';

const app = new Hono<AppEnv>();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      styleSrc: ["'unsafe-inline'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
    },
    referrerPolicy: 'no-referrer',
    crossOriginOpenerPolicy: false,
  })
);

/**
 * Per-IP rate limit for the unauthenticated, browser-facing endpoints, which
 * write to D1 or call GitHub. The binding is optional so tests and local dev
 * work without it; production config always sets it.
 */
const rateLimited = createMiddleware<AppEnv>(async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.env.RATE_LIMITER) {
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return c.html(pages.errorPage('Too many sign-in attempts. Please wait a minute.'), 429);
    }
  }
  await next();
});

// --- OIDC provider (used by Google) -----------------------------------------

app.get('/.well-known/openid-configuration', discovery);
app.get('/jwks', jwks);
app.on(['GET', 'POST'], '/authorize', rateLimited, authorize);
app.post('/token', token);
app.on(['GET', 'POST'], '/userinfo', userinfo);

// --- GitHub sign-in, then back to Google -------------------------------------

app.get('/login', rateLimited, async (c) => {
  const pendingId = getCookie(c, PENDING_COOKIE);
  if (!pendingId) return c.redirect('/');

  const code = c.req.query('code');
  const error = c.req.query('error');
  const state = c.req.query('state');
  const expectedState = await githubState(pendingId);
  if (code === undefined && error === undefined && state === undefined) {
    return c.redirect(await githubAuthorizeUrl(c.env, pendingId, expectedState));
  }
  if (!state || !timingSafeEqual(state, expectedState)) {
    return c.html(pages.errorPage('Sign-in was interrupted. Please start again from Google.'), 400);
  }

  deleteCookie(c, PENDING_COOKIE, { path: '/', secure: true });
  const pending = await takePending(c.env.DB, pendingId);
  if (!pending) {
    return c.html(pages.errorPage('Sign-in expired. Please start again from Google.'), 400);
  }
  if (error) {
    const url = new URL(pending.redirect_uri);
    url.searchParams.set(
      'error',
      error === 'access_denied' ? 'access_denied' : 'temporarily_unavailable'
    );
    if (pending.state) url.searchParams.set('state', pending.state);
    console.log(JSON.stringify({ event: 'signin.denied', reason: 'github_oauth_error' }));
    return c.redirect(url.toString());
  }
  if (!code) return c.html(pages.errorPage('GitHub did not return a code.'), 400);
  const githubToken = await exchangeGitHubCode(c.env, code, pendingId);
  let identity;
  try {
    identity = await readGitHubIdentity(githubToken);
  } finally {
    const revoke = revokeGitHubToken(c.env, githubToken);
    try {
      c.executionCtx.waitUntil(revoke);
    } catch {
      await revoke; // no execution context (tests)
    }
  }

  const result = await completeAuthorization(c.env, identity, pending);
  const log = { github_id: identity.id, github_login: identity.login };
  if (!result.ok) {
    console.log(JSON.stringify({ event: 'signin.denied', reason: result.reason, ...log }));
    return c.html(
      result.reason === 'identity_mismatch' || result.reason === 'identity_unverified'
        ? pages.identityPage(identity.login, result.reason)
        : result.reason === 'not_in_pilot'
          ? pages.pilotPage(identity.login)
          : pages.noAccountPage(identity.login, c.env.WORKSPACE_DOMAIN),
      403
    );
  }
  console.log(JSON.stringify({ event: 'signin', ...log }));
  return c.redirect(result.location);
});

app.get('/', (c) => c.html(pages.homePage(c.env.WORKSPACE_DOMAIN)));
app.get('/healthz', (c) => c.text('ok'));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    if (err.status === 502) console.warn(err.message);
    return c.html(
      pages.errorPage('Sign-in was interrupted. Please start again from Google.'),
      err.status
    );
  }
  console.error(err);
  return c.html(pages.errorPage('Something went wrong. Please try again in a minute.'), 500);
});

export { app };

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
