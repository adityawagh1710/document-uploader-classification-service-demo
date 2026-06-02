// Server-side GraphQL client for the wundergraph-router (used by API routes that
// have been migrated off direct backend access). The browser-side client is
// lib/ingestion-graphql.ts; this one runs in Next route handlers, so it uses a
// server env (ROUTER_GRAPHQL_URL) rather than NEXT_PUBLIC_*.
const ROUTER_URL = process.env.ROUTER_GRAPHQL_URL ?? "http://localhost:8099/graphql";

export async function routerGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const resp = await fetch(ROUTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await resp.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("router returned no data");
  }
  return json.data;
}
