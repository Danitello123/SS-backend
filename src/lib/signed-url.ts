import { createHmac, timingSafeEqual } from "crypto";

/**
 * Minimal HMAC-signed, time-limited download token (issue #589's "signed
 * download URL"). There is no S3/cloud storage in this codebase to issue a
 * presigned URL from, so this signs `${resource}.${expiresAt}` with a
 * server-held secret instead -- same guarantee (can't be forged, can't be
 * used past its expiry), served from a local route rather than object
 * storage.
 */
export interface SignedToken {
  token: string;
  expiresAt: number;
}

function sign(secret: string, resource: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`${resource}.${expiresAt}`).digest("hex");
}

export function createSignedDownloadToken(
  secret: string,
  resource: string,
  ttlMinutes: number,
  now: Date = new Date(),
): SignedToken {
  const expiresAt = now.getTime() + ttlMinutes * 60 * 1000;
  const signature = sign(secret, resource, expiresAt);
  return { token: `${expiresAt}.${signature}`, expiresAt };
}

/**
 * Verifies a token produced by `createSignedDownloadToken` for the same
 * `resource`. Returns `false` for a malformed, expired, or mismatched-secret
 * token -- callers should not distinguish why.
 */
export function verifySignedDownloadToken(
  secret: string,
  resource: string,
  token: string,
  now: Date = new Date(),
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expiresAtPart = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);
  const expiresAt = Number(expiresAtPart);
  if (!Number.isFinite(expiresAt)) return false;
  if (expiresAt <= now.getTime()) return false;

  const expectedSignature = sign(secret, resource, expiresAt);

  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signaturePart, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
