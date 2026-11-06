/**
 * Small helpers around jose and WebCrypto. All JWT/JWK work goes through jose;
 * this file only adds key caching and the few primitives jose doesn't cover.
 */
import { calculateJwkThumbprint, exportJWK, importPKCS8, type JWK } from 'jose';

const encoder = new TextEncoder();

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256, base64url. Used for PKCE and to store codes and session IDs hashed. */
export async function sha256(input: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

/** Constant-time comparison for secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** RFC 7636 S256 check. */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return timingSafeEqual(await sha256(verifier), challenge);
}

export interface SigningKey {
  privateKey: CryptoKey;
  publicJwk: JWK & { kid: string };
}

const signingKeys = new Map<string, Promise<SigningKey>>();

/** Loads the OIDC signing key once per isolate; kid is the RFC 7638 thumbprint. */
export function loadSigningKey(pkcs8Pem: string): Promise<SigningKey> {
  let cached = signingKeys.get(pkcs8Pem);
  if (!cached) {
    cached = (async () => {
      const privateKey = await importPKCS8(pkcs8Pem, 'RS256', { extractable: true });
      const { kty, n, e } = await exportJWK(privateKey);
      const publicJwk = { kty, n, e, alg: 'RS256', use: 'sig' };
      const kid = await calculateJwkThumbprint(publicJwk);
      return { privateKey, publicJwk: { ...publicJwk, kid } };
    })();
    signingKeys.set(pkcs8Pem, cached);
  }
  return cached;
}
