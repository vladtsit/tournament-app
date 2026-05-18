import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { env } from './env.js';

// Singleton CosmosClient per Functions host instance (created lazily on first
// access; reused across invocations). Per spec §7.2.

let client: CosmosClient | undefined;
let database: Database | undefined;
const containers = new Map<string, Container>();

function getClient(): CosmosClient {
  if (!client) {
    client = new CosmosClient({
      endpoint: env.cosmosEndpoint,
      key: env.cosmosKey,
      // Sensible defaults for serverless / low-volume free-tier workloads.
      connectionPolicy: {
        requestTimeout: 10_000,
      },
    });
  }
  return client;
}

function getDatabase(): Database {
  if (!database) {
    database = getClient().database(env.cosmosDatabaseId);
  }
  return database;
}

export function container(name: string): Container {
  let c = containers.get(name);
  if (!c) {
    c = getDatabase().container(name);
    containers.set(name, c);
  }
  return c;
}

// Convenience handles — one per container we use.
export const containers_ = {
  users: () => container('users'),
};
