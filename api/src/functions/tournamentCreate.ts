import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";

// POST /api/tournaments
// Body: { name?: string, tiebreakRule?: 'regular_set'|'super_tiebreak_to_10' }
//
// Creates a new tournament in the JWT's group with status='registration_open'.
// Admin-only. If a current (not-ended) tournament already exists, returns 409.

interface CreateBody {
  name?: string;
  tiebreakRule?: "regular_set" | "super_tiebreak_to_10";
}

interface TournamentDoc {
  id: string;
  groupId: string;
  name: string;
  status: "draft" | "registration_open" | "live" | "ended";
  settings: {
    tiebreakRule: "regular_set" | "super_tiebreak_to_10";
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

app.http("tournamentCreate", {
  route: "tournaments",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
    }

    let body: CreateBody;
    try {
      body = ((await req.json()) ?? {}) as CreateBody;
    } catch {
      body = {};
    }

    // Disallow a second current tournament.
    const existing = await containers_
      .tournaments()
      .items.query<{ id: string; status: string }>(
        {
          query:
            "SELECT TOP 1 c.id, c.status FROM c WHERE c.groupId = @g AND c.status IN ('draft','registration_open','live') ORDER BY c.createdAt DESC",
          parameters: [{ name: "@g", value: ctx.groupId }],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();
    if (existing.resources.length > 0) {
      return jsonError(
        409,
        "tournament_already_active",
        "A tournament is already active in this group.",
      );
    }

    const now = new Date().toISOString();
    const doc: TournamentDoc = {
      id: randomUUID(),
      groupId: ctx.groupId,
      name: body.name?.trim() || defaultName(now),
      status: "registration_open",
      settings: {
        tiebreakRule: body.tiebreakRule ?? "super_tiebreak_to_10",
      },
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };

    await containers_.tournaments().items.create(doc);

    return {
      status: 201,
      jsonBody: { tournament: doc },
    };
  },
});

function defaultName(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `Pádel ${y}-${m}-${day}`;
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
