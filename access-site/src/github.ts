/**
 * The interactive GitHub sign-in is handled by @hono/oauth-providers. This
 * file only covers the nightly job's lookup of a GitHub ID's current login.
 */

export type GitHubLookup =
  | { status: 'found'; login: string }
  | { status: 'not_found' }
  | { status: 'error'; detail: string };

/** Resolves a numeric GitHub user ID to its current login (logins can be renamed; IDs cannot). */
export async function githubLoginForId(id: string, token?: string): Promise<GitHubLookup> {
  if (!/^\d+$/.test(id)) return { status: 'error', detail: 'non-numeric id' };
  try {
    const res = await fetch(`https://api.github.com/user/${id}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'access.modelcontextprotocol.io',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { login?: string };
    return body.login
      ? { status: 'found', login: body.login }
      : { status: 'error', detail: 'no login in response' };
  } catch (err) {
    return { status: 'error', detail: String(err) };
  }
}
