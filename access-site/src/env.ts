export interface Env {
  DB: D1Database;
  /** Per-IP limit for /authorize and /login (optional so tests run without it). */
  RATE_LIMITER?: RateLimit;

  ISSUER: string;
  WORKSPACE_DOMAIN: string;
  GITHUB_CLIENT_ID: string;
  OIDC_CLIENT_ID: string;
  /** Comma-separated list of exact redirect URIs accepted from the OIDC client. */
  OIDC_REDIRECT_URIS: string;
  /**
   * Optional comma-separated GitHub logins. When set, only these users can
   * sign in (rollout pilot); remove it to open sign-in to verified Workspace accounts in users.ts.
   */
  PILOT_GITHUB_LOGINS?: string;

  OIDC_CLIENT_SECRET: string;
  /** RSA private key, PKCS#8 PEM. */
  OIDC_SIGNING_KEY: string;
  /**
   * Optional JWK Set (JSON) of public keys published alongside the signing key
   * during rotation: the next key before cutover, the previous one after.
   */
  OIDC_ROTATION_JWKS?: string;
  GITHUB_CLIENT_SECRET: string;
}

export type AppEnv = { Bindings: Env };
