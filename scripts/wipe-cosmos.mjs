// scripts/wipe-cosmos.mjs
// Wipes ALL Cosmos containers used by the Padel app. Dev/preview only.
// Usage:
//   node scripts/wipe-cosmos.mjs            # dry run (default)
//   node scripts/wipe-cosmos.mjs --confirm  # actually deletes
//
// Reads connection from COSMOS_ENDPOINT + COSMOS_KEY (or COSMOS_CONNECTION_STRING)
// and COSMOS_DATABASE (default: "padel").

import { CosmosClient } from "@azure/cosmos";
import process from "node:process";

const CONTAINERS = [
  "users",
  "groups",
  "group_users",
  "audit",
  "tournaments",
  "registrations",
  "teams",
  "team_invites",
  "team_slots",
  "matches",
  "player_stats",
  "idempotency",
];

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const conn = process.env.COSMOS_CONNECTION_STRING;
const databaseId = process.env.COSMOS_DATABASE ?? "padel";

if (!conn && !(endpoint && key)) {
  console.error(
    "Missing COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT + COSMOS_KEY",
  );
  process.exit(1);
}

const client = conn
  ? new CosmosClient(conn)
  : new CosmosClient({ endpoint, key });
const db = client.database(databaseId);

console.log(`Target database: ${databaseId}`);
console.log(`Mode: ${confirm ? "DELETE" : "DRY RUN (pass --confirm to delete)"}`);

let total = 0;
for (const name of CONTAINERS) {
  const c = db.container(name);
  try {
    const { resources } = await c.items
      .query("SELECT VALUE COUNT(1) FROM c")
      .fetchAll();
    const count = resources[0] ?? 0;
    console.log(`  ${name}: ${count} item(s)`);
    total += count;
    if (!confirm) continue;

    // Read all items in pages and delete one by one.
    const iter = c.items.query("SELECT c.id, c._pk FROM c", {
      maxItemCount: 200,
    });
    // We need the partition key value, but the SELECT above only gives id.
    // Use SELECT * to get the full doc (Cosmos discovers the PK by definition).
    const full = c.items.query("SELECT * FROM c", { maxItemCount: 200 });
    while (full.hasMoreResults()) {
      const page = await full.fetchNext();
      for (const doc of page.resources) {
        // Determine partition key by container definition (cached).
        const pkDef = await (async () => {
          const { resource } = await c.read();
          return resource?.partitionKey?.paths ?? ["/id"];
        })();
        const path = pkDef[0].replace(/^\//, "");
        const pkValue = doc[path];
        try {
          await c.item(doc.id, pkValue).delete();
        } catch (err) {
          console.error(`    failed ${name}/${doc.id}:`, err.message ?? err);
        }
      }
    }
  } catch (err) {
    console.error(`  ${name}: error — ${err.message ?? err}`);
  }
}

console.log(`Total items observed: ${total}`);
console.log(confirm ? "Done." : "Dry run complete. Re-run with --confirm to delete.");
