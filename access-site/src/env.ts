export interface Env {
  DB: D1Database;

  ISSUER: string;
  WORKSPACE_DOMAIN: string;
  GITHUB_CLIENT_ID: string;
  OIDC_CLIENT_ID: string;
  /** Comma-separated list of exact redirect URIs accepted from the OIDC client. */
  OIDC_REDIRECT_URIS: string;

  OIDC_CLIENT_SECRET: string;
  /** RSA private key, PKCS#8 PEM. */
  OIDC_SIGNING_KEY: string;
  /** Optional public JWK (JSON) of the previous signing key, published during rotation. */
  OIDC_PREVIOUS_JWK?: string;
  GITHUB_CLIENT_SECRET: string;
}

export type AppEnv = { Bindings: Env };
