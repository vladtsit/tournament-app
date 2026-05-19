import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";

// GET /api/tournaments/{tournamentId}/bbq-export
// Admin-only. CSV columns: userId, firstName, lastName, playing, bbq, updatedAt.

interface RegistrationDoc {
  id: string;
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
  bbq: boolean;
  updatedAt: string;
}

app.http("adminBbqExport", {
  route: "tournaments/{tournamentId}/bbq-export",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const tournamentId = req.params["tournamentId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const q = await containers_
      .registrations()
      .items.query<RegistrationDoc>(
        {
          query:
            "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t ORDER BY c.firstName",
          parameters: [
            { name: "@g", value: ctx.groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();

    const rows: string[] = [
      ["userId", "firstName", "lastName", "playing", "bbq", "updatedAt"]
        .map(csvCell)
        .join(","),
    ];
    for (const r of q.resources) {
      rows.push(
        [
          r.userId,
          r.firstName,
          r.lastName ?? "",
          r.playing ? "true" : "false",
          r.bbq ? "true" : "false",
          r.updatedAt,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bbq-${tournamentId}.csv"`,
      },
      body: rows.join("\n") + "\n",
    };
  },
});

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
