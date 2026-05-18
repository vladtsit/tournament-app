import type { HttpRequest } from "@azure/functions";
import { requireAuth, AuthError, type AuthContext } from "./requireAuth.js";
import { containers_ } from "./cosmos.js";

// Helpers used by per-group endpoints: ensure a session JWT exists, the user
// has a selected group, and (optionally) is an app admin of that group.

export class GroupContextError extends Error {
  constructor(
    public readonly code:
      | "missing_token"
      | "invalid_token"
      | "group_required"
      | "not_a_member"
      | "not_admin"
      | "group_not_found",
  ) {
    super(code);
    this.name = "GroupContextError";
  }
}

export interface GroupContext extends AuthContext {
  groupId: string;
}

export interface GroupAdminContext extends GroupContext {
  isAdmin: true;
}

export async function requireGroup(req: HttpRequest): Promise<GroupContext> {
  let auth: AuthContext;
  try {
    auth = await requireAuth(req);
  } catch (err) {
    if (err instanceof AuthError) {
      throw new GroupContextError(err.code);
    }
    throw err;
  }
  if (!auth.groupId) throw new GroupContextError("group_required");
  return { ...auth, groupId: auth.groupId };
}

export async function requireGroupAdmin(
  req: HttpRequest,
): Promise<GroupAdminContext> {
  const ctx = await requireGroup(req);
  const membership = await containers_
    .groupUsers()
    .item(`${ctx.groupId}_${ctx.userId}`, ctx.groupId)
    .read<{ isAdmin: boolean; status: string }>()
    .catch(() => null);
  const doc = membership?.resource;
  if (!doc || doc.status === "left" || doc.status === "kicked") {
    throw new GroupContextError("not_a_member");
  }
  if (!doc.isAdmin) throw new GroupContextError("not_admin");
  return { ...ctx, isAdmin: true };
}

export function mapGroupContextError(err: unknown): {
  status: number;
  code: string;
} {
  if (err instanceof GroupContextError) {
    switch (err.code) {
      case "missing_token":
      case "invalid_token":
        return { status: 401, code: err.code };
      case "not_admin":
      case "not_a_member":
        return { status: 403, code: err.code };
      case "group_required":
      case "group_not_found":
        return { status: 400, code: err.code };
    }
  }
  return { status: 500, code: "internal_error" };
}
