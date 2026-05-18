import type { HttpRequest } from "@azure/functions";
import { verifySession, type SessionClaims } from "./session.js";

export interface AuthContext {
  userId: string;
  language: string;
  groupId?: string;
  claims: SessionClaims;
}

export class AuthError extends Error {
  constructor(public readonly code: "missing_token" | "invalid_token") {
    super(code);
    this.name = "AuthError";
  }
}

function extractBearer(req: HttpRequest): string | undefined {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

/**
 * Verify the Authorization: Bearer JWT on a request and return the resolved
 * auth context. Throws `AuthError` if missing or invalid.
 */
export async function requireAuth(req: HttpRequest): Promise<AuthContext> {
  const token = extractBearer(req);
  if (!token) throw new AuthError("missing_token");

  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
  } catch {
    throw new AuthError("invalid_token");
  }
  const ctx: AuthContext = {
    userId: claims.sub,
    language: claims.lng,
    claims,
  };
  if (claims.gid) ctx.groupId = claims.gid;
  return ctx;
}
