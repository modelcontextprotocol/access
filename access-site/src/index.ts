import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { githubAuth } from '@hono/oauth-providers/github';
import type { AppEnv, Env } from './env';
import { randomToken } from './crypto';
import { createSession, deleteSession, getSession, takePending, type Session } from './db';
import { accountRequestFor, ensureAccount, resolveAccount, type GitHubIdentity } from './accounts';
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
import { splitName, suggestPrefix } from './validation';
import { runNightly } from './cron';

const SESSION_COOKIE = '__Host-mcp_session';
const SESSION_TTL = 3600;

const app = new Hono<AppEnv>();

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'none'"],
      styleSrc: ["'unsafe-inline'"],
      formAction: ["'self'"],
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

// --- GitHub sign-in ------------------------------------------------------------

app.get(
  '/login',
  (c, next) =>
    githubAuth({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      redirect_uri: `${c.env.ISSUER}/login`,
    })(c, next),
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

    // A Google sign-in is waiting: hand back a code if this user can sign in.
    const pendingId = getCookie(c, PENDING_COOKIE);
    let signInBlocked = false;
    if (pendingId) {
      deleteCookie(c, PENDING_COOKIE, { path: '/', secure: true });
      const pending = await takePending(c.env.DB, pendingId);
      if (pending) {
        const location = await completeAuthorization(c.env, identity, pending);
        if (location) return c.redirect(location);
        signInBlocked = true;
      }
    }

    const sessionId = randomToken();
    await createSession(
      c.env.DB,
      sessionId,
      { github_id: identity.id, github_login: identity.login, github_name: identity.name },
      SESSION_TTL
    );
    setCookie(c, SESSION_COOKIE, sessionId, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_TTL,
    });
    return c.redirect(signInBlocked ? '/?signin=blocked' : '/');
  }
);

// --- Account page ----------------------------------------------------------------

function identityOf(s: Session): GitHubIdentity {
  return { id: s.github_id, login: s.github_login, name: s.github_name };
}

async function renderHome(
  env: Env,
  identity: GitHubIdentity,
  opts: { notice?: string; error?: string; form?: Record<string, string> } = {}
) {
  const account = await resolveAccount(env, identity.id);
  if (account?.suspended)
    return pages.suspendedPage({ login: identity.login, email: account.email });
  if (account) {
    return pages.accountReadyPage({
      login: identity.login,
      email: account.email,
      created: false,
      domain: env.WORKSPACE_DOMAIN,
    });
  }
  const request = accountRequestFor(env, identity);
  if (!request) return pages.notEligiblePage({ login: identity.login });
  const name = splitName(identity.name);
  return pages.createAccountPage({
    login: identity.login,
    domain: env.WORKSPACE_DOMAIN,
    firstName: opts.form?.firstName ?? name.first,
    lastName: opts.form?.lastName ?? name.last,
    fixedEmail: request.kind === 'link' ? request.email : null,
    prefix: opts.form?.prefix ?? suggestPrefix(identity.login),
    notice: opts.notice,
    error: opts.error,
  });
}

app.get('/', async (c) => {
  const session = await getSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!session) return c.html(pages.signedOutPage());
  const notice =
    c.req.query('signin') === 'blocked'
      ? 'You need an active @modelcontextprotocol.io account before you can sign in to Google.'
      : undefined;
  return c.html(await renderHome(c.env, identityOf(session), { notice }));
});

app.post('/account', csrf(), async (c) => {
  const session = await getSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!session) return c.redirect('/');
  const identity = identityOf(session);
  const body = await c.req.parseBody();
  const form = {
    firstName: String(body.firstName ?? ''),
    lastName: String(body.lastName ?? ''),
    prefix: String(body.prefix ?? ''),
  };
  const result = await ensureAccount(c.env, identity, form);
  if (!result.ok)
    return c.html(await renderHome(c.env, identity, { error: result.error, form }), 400);
  return c.html(
    pages.accountReadyPage({
      login: identity.login,
      email: result.email,
      created: result.created,
      domain: c.env.WORKSPACE_DOMAIN,
    })
  );
});

app.post('/logout', csrf(), async (c) => {
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.redirect('/');
});

app.get('/healthz', (c) => c.text('ok'));

app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) {
    return c.html(
      pages.errorPage('Sign-in expired or was interrupted. Please try again.'),
      err.status
    );
  }
  console.error(err);
  return c.html(pages.errorPage('Something went wrong. Please try again in a minute.'), 500);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
} satisfies ExportedHandler<Env>;
