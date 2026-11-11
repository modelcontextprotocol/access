import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

function layout(body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>MCP sign-in</title>
        <style>
          :root {
            color-scheme: light dark;
          }
          body {
            margin: 0;
            font:
              16px/1.5 system-ui,
              sans-serif;
          }
          main {
            max-width: 32rem;
            margin: 3rem auto;
            padding: 0 1rem;
          }
          h1 {
            font-size: 1.4rem;
          }
          .error {
            color: #b3261e;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Model Context Protocol sign-in</h1>
          ${body}
        </main>
      </body>
    </html>`;
}

export function homePage(domain: string): Html {
  return layout(
    html`<p>
        This service signs maintainers in to their <strong>@${domain}</strong> Google account with
        GitHub. Open <a href="https://mail.google.com/a/${domain}">Gmail</a> or any Google app to
        sign in.
      </p>
      <p>
        Accounts are managed in
        <a href="https://github.com/modelcontextprotocol/access">modelcontextprotocol/access</a>.
      </p>`
  );
}

export function noAccountPage(login: string, domain: string): Html {
  return layout(
    html`<p class="error">@${login} has no @${domain} account.</p>
      <p>
        If you expect a Workspace account, ask the Infrastructure WG to check your entry in
        <a href="https://github.com/modelcontextprotocol/access">modelcontextprotocol/access</a>.
      </p>`
  );
}

export function identityPage(
  login: string,
  reason: 'identity_mismatch' | 'identity_unverified'
): Html {
  return layout(
    html`<p class="error">Sign-in refused for @${login}.</p>
      <p>
        ${reason === 'identity_unverified'
          ? 'This Workspace account has no verified GitHub ID for sign-in yet.'
          : 'This GitHub account does not match the verified ID for this Workspace account.'}
        Ask the Infrastructure WG to check your entry in
        <a href="https://github.com/modelcontextprotocol/access">modelcontextprotocol/access</a>.
      </p>`
  );
}

export function pilotPage(login: string): Html {
  return layout(
    html`<p class="error">GitHub sign-in isn't enabled for @${login} yet.</p>
      <p>
        It is being piloted with a few maintainers first. Please use your usual sign-in for now.
      </p>`
  );
}

export function errorPage(message: string): Html {
  return layout(html`<p class="error">${message}</p>`);
}
