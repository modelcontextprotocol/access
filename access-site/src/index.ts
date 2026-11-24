import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { githubAuth } from '@hono/oauth-providers/github';
import type { AppEnv, Env } from './env';
import { takePending } from './db';
import {
  authorize,
  completeAuthorization,
  discovery,
  jwks,
  PENDING_COOKIE,
  token,
  userinfo,
  type GitHubIdentity,
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
  })
);

// --- OIDC provider (used by Google) -----------------------------------------

app.get('/.well-known/openid-configuration', discovery);
app.get('/jwks', jwks);
app.get('/authorize', authorize);
app.post('/token', token);
app.on(['GET', 'POST'], '/userinfo', userinfo);

// --- GitHub sign-in, then back to Google -------------------------------------

app.get(
  '/login',
  async (c, next) => {
    // Only start a GitHub sign-in when Google is waiting for one.
    if (!getCookie(c, PENDING_COOKIE)) return c.redirect('/');
    return githubAuth({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      redirect_uri: `${c.env.ISSUER}/login`,
    })(c, next);
  },
  async (c) => {
    const user = c.get('user-github');
    if (typeof user?.id !== 'number' || typeof user.login !== 'string') {
      throw new HTTPException(502, { message: 'GitHub did not return a user.' });
    }
    const identity: GitHubIdentity = {
      id: String(user.id),
      login: user.login,
      name: user.name ?? null,
    };

    const pendingId = getCookie(c, PENDING_COOKIE);
    deleteCookie(c, PENDING_COOKIE, { path: '/', secure: true });
    const pending = pendingId ? await takePending(c.env.DB, pendingId) : null;
    if (!pending) {
      return c.html(pages.errorPage('Sign-in expired. Please start again from Google.'), 400);
    }

    const location = await completeAuthorization(c.env, identity, pending);
    if (!location) {
      console.log(
        JSON.stringify({
          event: 'signin.denied',
          github_id: identity.id,
          github_login: identity.login,
        })
      );
      return c.html(pages.noAccountPage(identity.login, c.env.WORKSPACE_DOMAIN), 403);
    }
    console.log(
      JSON.stringify({ event: 'signin', github_id: identity.id, github_login: identity.login })
    );
    return c.redirect(location);
  }
);

app.get('/', (c) => c.html(pages.homePage(c.env.WORKSPACE_DOMAIN)));
app.get('/healthz', (c) => c.text('ok'));

app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
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
