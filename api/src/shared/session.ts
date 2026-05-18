import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { env } from "./env.js";

// HS256 session JWT issued after successful Telegram initData validation.
// Spec §10.6 / §10.7. Bearer-preferred delivery.

const ISSUER = "tournamentes";
const AUDIENCE = "tournamentes-app";

export interface SessionClaims extends JWTPayload {
  /** Telegram numeric user id. */
  sub: string;
  /** Language code resolved from initData (e.g. 'en', 'es', 'ru'). */
  lng: string;
  /** Optional group id when authenticated in group context. */
  gid?: string;
}

function key(): Uint8Array {
  return new TextEncoder().encode(env.jwtSecret);
}

export async function issueSession(payload: {
  userId: number | string;
  language: string;
  groupId?: string;
}): Promise<string> {
  const claims: SessionClaims = {
    sub: String(payload.userId),
    lng: payload.language,
  };
  if (payload.groupId) claims.gid = payload.groupId;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.jwtTtlSeconds}s`)
    .sign(key());
}

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, key(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.sub !== "string" || typeof payload["lng"] !== "string") {
    throw new Error("invalid_session_claims");
  }
  return payload as SessionClaims;
}
