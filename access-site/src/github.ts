import { HTTPException } from 'hono/http-exception';
import { sha256 } from './crypto';
import type { Env } from './env';
import type { GitHubIdentity } from './oidc';

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'access.modelcontextprotocol.io',
};

export function githubState(pendingId: string): Promise<string> {
  // Keep OAuth state distinct from the PKCE challenge. Both are bound to
  // the pending Google request and neither reveals its host-only cookie.
  return sha256(`github-state:${pendingId}`);
}

export async function githubAuthorizeUrl(
  env: Env,
  pendingId: string,
  state: string
): Promise<string> {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${env.ISSUER}/login`,
    state,
    code_challenge: await sha256(pendingId),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

/** The GitHub token is only needed to read the user once. */
export async function revokeGitHubToken(env: Env, accessToken: string): Promise<void> {
  try {
    await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
      method: 'DELETE',
      redirect: 'error',
      headers: {
        ...githubHeaders,
        Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  } catch {
    // Best effort; the token expires on its own.
  }
}

export async function exchangeGitHubCode(
  env: Env,
  code: string,
  verifier: string
): Promise<string> {
  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        redirect_uri: `${env.ISSUER}/login`,
        code,
        code_verifier: verifier,
      }),
    });
    if (response.ok) {
      const data = (await response.json()) as { access_token?: unknown } | null;
      if (typeof data?.access_token === 'string' && data.access_token) return data.access_token;
    }
  } catch {
    // Never include GitHub response bodies or OAuth credentials in errors.
  }
  throw new HTTPException(502, { message: 'GitHub did not return an access token.' });
}

export async function readGitHubIdentity(accessToken: string): Promise<GitHubIdentity> {
  try {
    const response = await fetch('https://api.github.com/user', {
      redirect: 'error',
      headers: { ...githubHeaders, Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const user = (await response.json()) as Partial<GitHubIdentity> | null;
      if (
        typeof user?.id === 'number' &&
        Number.isSafeInteger(user.id) &&
        user.id > 0 &&
        typeof user.login === 'string' &&
        user.login
      ) {
        return {
          id: user.id,
          login: user.login,
          name: typeof user.name === 'string' ? user.name : null,
        };
      }
    }
  } catch {
    // Keep upstream errors separate from unexpected Worker failures.
  }
  throw new HTTPException(502, { message: 'GitHub did not return a user.' });
}
