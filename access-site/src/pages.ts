import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function layout(body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>MCP Access</title>
        <style>
          :root {
            color-scheme: light dark;
            --fg: #1a1a1a;
            --muted: #5f6368;
            --bg: #fff;
            --card: #f6f7f8;
            --accent: #1f6feb;
            --err: #b3261e;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --fg: #e8eaed;
              --muted: #9aa0a6;
              --bg: #121212;
              --card: #1e1f21;
              --accent: #4c8dff;
              --err: #f2b8b5;
            }
          }
          body {
            margin: 0;
            font:
              16px/1.5 system-ui,
              sans-serif;
            color: var(--fg);
            background: var(--bg);
          }
          main {
            max-width: 32rem;
            margin: 3rem auto;
            padding: 0 1rem;
          }
          h1 {
            font-size: 1.4rem;
            margin: 0 0 1rem;
          }
          .card {
            background: var(--card);
            border-radius: 12px;
            padding: 1.25rem;
            margin: 1rem 0;
          }
          .muted {
            color: var(--muted);
            font-size: 0.9rem;
          }
          .error {
            color: var(--err);
          }
          label {
            display: block;
            margin: 0.75rem 0 0.25rem;
            font-weight: 600;
          }
          input {
            width: 100%;
            box-sizing: border-box;
            padding: 0.55rem;
            border-radius: 8px;
            border: 1px solid var(--muted);
            background: var(--bg);
            color: var(--fg);
            font: inherit;
          }
          .suffix {
            display: flex;
            align-items: center;
            gap: 0.4rem;
          }
          button,
          .button {
            display: inline-block;
            margin-top: 1rem;
            padding: 0.6rem 1rem;
            border: 0;
            border-radius: 8px;
            background: var(--accent);
            color: #fff;
            font: inherit;
            text-decoration: none;
            cursor: pointer;
          }
          form.inline {
            display: inline;
          }
          .link-button {
            background: none;
            color: var(--muted);
            padding: 0;
            margin: 0;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Model Context Protocol access</h1>
          ${body}
        </main>
      </body>
    </html>`;
}

function signOut(): Html {
  return html`<form class="inline" method="post" action="/logout">
    <button class="link-button" type="submit">Sign out</button>
  </form>`;
}

export function signedOutPage(): Html {
  return layout(
    html`<div class="card">
      <p>
        Sign in with GitHub to set up or check your
        <strong>@modelcontextprotocol.io</strong> account.
      </p>
      <a class="button" href="/login">Sign in with GitHub</a>
    </div>`
  );
}

export function accountReadyPage(opts: {
  login: string;
  email: string;
  created: boolean;
  domain: string;
}): Html {
  return layout(
    html`<div class="card">
        <p>
          ${opts.created ? 'Your account is ready:' : 'Your account:'}
          <strong>${opts.email}</strong>
        </p>
        <p class="muted">
          You sign in to Google with your GitHub account. There is no Google password.
        </p>
        <a class="button" href="https://mail.google.com/a/${opts.domain}">Open Gmail</a>
      </div>
      <p class="muted">Signed in as @${opts.login}. ${signOut()}</p>`
  );
}

export function suspendedPage(opts: { login: string; email: string }): Html {
  return layout(
    html`<div class="card">
        <p>Your account <strong>${opts.email}</strong> is suspended.</p>
        <p class="muted">
          This happens when you are no longer in a team that has Workspace accounts. Ask in the
          Infrastructure WG channel if this looks wrong.
        </p>
      </div>
      <p class="muted">Signed in as @${opts.login}. ${signOut()}</p>`
  );
}

export function notEligiblePage(opts: { login: string }): Html {
  return layout(
    html`<div class="card">
        <p>@${opts.login} is not in a team that can have an @modelcontextprotocol.io account.</p>
        <p class="muted">
          Accounts are available to maintainers and other roles listed in
          <a href="https://github.com/modelcontextprotocol/access">modelcontextprotocol/access</a>.
        </p>
      </div>
      <p class="muted">${signOut()}</p>`
  );
}

export function createAccountPage(opts: {
  login: string;
  domain: string;
  firstName: string;
  lastName: string;
  /** Fixed address from users.ts, or null to let the user choose. */
  fixedEmail: string | null;
  prefix: string;
  error?: string;
  notice?: string;
}): Html {
  return layout(
    html`${opts.notice ? html`<p class="muted">${opts.notice}</p>` : ''}
      <div class="card">
        <p>
          ${opts.fixedEmail
            ? html`Confirm your details to set up <strong>${opts.fixedEmail}</strong>.`
            : 'Create your @modelcontextprotocol.io account.'}
        </p>
        ${opts.error ? html`<p class="error">${opts.error}</p>` : ''}
        <form method="post" action="/account">
          <label for="firstName">First name</label>
          <input
            id="firstName"
            name="firstName"
            value="${opts.firstName}"
            required
            maxlength="60"
          />
          <label for="lastName">Last name</label>
          <input id="lastName" name="lastName" value="${opts.lastName}" required maxlength="60" />
          ${opts.fixedEmail
            ? ''
            : html`<label for="prefix">Email</label>
                <div class="suffix">
                  <input
                    id="prefix"
                    name="prefix"
                    value="${opts.prefix}"
                    required
                    maxlength="30"
                    pattern="[a-z][a-z0-9.-]*"
                  />
                  <span>@${opts.domain}</span>
                </div>`}
          <button type="submit">${opts.fixedEmail ? 'Set up account' : 'Create account'}</button>
        </form>
      </div>
      <p class="muted">Signed in as @${opts.login}. ${signOut()}</p>`
  );
}

export function errorPage(message: string): Html {
  return layout(
    html`<div class="card">
      <p class="error">${message}</p>
      <a href="/">Back</a>
    </div>`
  );
}
