"use client";

/**
 * GraphQL client for the Go wundergraph-router (the ingestion front door).
 * This is the Approach-A repoint mechanism: UI talks GraphQL to the router
 * instead of the in-process REST `/api/*` routes. Existing pages keep working;
 * a page opts in by importing these functions. Endpoint via
 * NEXT_PUBLIC_INGESTION_GRAPHQL_URL (default http://localhost:8099/graphql).
 *
 * Plain `fetch` — no GraphQL client dependency added.
 */

const ENDPOINT =
  process.env.NEXT_PUBLIC_INGESTION_GRAPHQL_URL ?? "http://localhost:8099/graphql";

interface GraphQLError {
  message: string;
}
interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!json.data) {
    throw new Error("graphql: empty response");
  }
  return json.data;
}

export interface Workspace {
  id: string;
  status: string;
  retentionDays?: number | null;
}

export interface Document {
  id: string;
  workspaceId: string;
  filename: string;
  contentType: string;
  status: string;
  pipelineStage?: string | null;
}

export interface CreateDocumentResult {
  document: Document;
  uploadUrl: string;
}

export const ingestionEndpoint = (): string => ENDPOINT;

export async function listWorkspaces(): Promise<Workspace[]> {
  const d = await gql<{ workspaces: Workspace[] }>(
    "query { workspaces { id status retentionDays } }",
  );
  return d.workspaces;
}

export async function createWorkspace(retentionDays?: number): Promise<Workspace> {
  const d = await gql<{ createWorkspace: Workspace }>(
    "mutation($r: Int) { createWorkspace(input: { retentionDays: $r }) { id status retentionDays } }",
    { r: retentionDays },
  );
  return d.createWorkspace;
}

export async function listDocuments(workspaceId: string): Promise<Document[]> {
  const d = await gql<{ documents: Document[] }>(
    "query($w: ID!) { documents(workspaceId: $w) { id workspaceId filename contentType status pipelineStage } }",
    { w: workspaceId },
  );
  return d.documents;
}

export async function createDocument(
  workspaceId: string,
  filename: string,
  contentType?: string,
): Promise<CreateDocumentResult> {
  const d = await gql<{ createDocument: CreateDocumentResult }>(
    "mutation($w: ID!, $f: String!, $c: String) { createDocument(input: { workspaceId: $w, filename: $f, contentType: $c }) { document { id workspaceId filename contentType status } uploadUrl } }",
    { w: workspaceId, f: filename, c: contentType },
  );
  return d.createDocument;
}

export async function classifyDocument(documentId: string): Promise<Document> {
  const d = await gql<{ classifyDocument: Document }>(
    "mutation($d: ID!) { classifyDocument(documentId: $d) { id workspaceId filename contentType status pipelineStage } }",
    { d: documentId },
  );
  return d.classifyDocument;
}

export async function getDocument(id: string): Promise<Document | null> {
  const d = await gql<{ document: Document | null }>(
    "query($id: ID!) { document(id: $id) { id workspaceId filename contentType status pipelineStage } }",
    { id },
  );
  return d.document;
}

export async function stats(): Promise<{ workspaces: number; documents: number }> {
  const d = await gql<{ stats: { workspaces: number; documents: number } }>(
    "query { stats { workspaces documents } }",
  );
  return d.stats;
}
