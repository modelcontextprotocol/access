export interface Env {
  DB: D1Database;

  ISSUER: string;
  WORKSPACE_DOMAIN: string;
  WORKSPACE_OU_PATH: string;
  GITHUB_CLIENT_ID: string;
  OIDC_CLIENT_ID: string;
  /** Comma-separated list of exact redirect URIs accepted from the OIDC client. */
  OIDC_REDIRECT_URIS: string;
  /** "report" (default) or "enforce". */
  OFFBOARDING_MODE: string;
  OFFBOARDING_MAX_PER_RUN: string;

  OIDC_CLIENT_SECRET: string;
  /** RSA private key, PKCS#8 PEM. */
  OIDC_SIGNING_KEY: string;
  /** Optional public JWK (JSON) of the previous signing key, published during rotation. */
  OIDC_PREVIOUS_JWK?: string;
  GITHUB_CLIENT_SECRET: string;
  /** Google service account JSON key. */
  GOOGLE_SA_KEY: string;
  /** Optional token for the nightly job's GitHub API lookups (higher rate limit). */
  GITHUB_API_TOKEN?: string;
}

export type AppEnv = { Bindings: Env };
