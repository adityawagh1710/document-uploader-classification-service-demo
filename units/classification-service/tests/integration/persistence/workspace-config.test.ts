import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { silentLogger } from "../../../src/ports/Logger.js";
import { createDDBWorkspaceConfigAdapter } from "../../../src/adapters/dynamo-workspace-config/index.js";
import type { WorkspaceConfigStore } from "../../../src/ports/WorkspaceConfigStore.js";
import type { WorkspaceConfig } from "../../../src/shared/types.js";
import { getLocalstack } from "../_helpers.js";

let workspaceId: string;
let store: WorkspaceConfigStore;

beforeEach(() => {
  const { ddb, workspaceConfigTable } = getLocalstack();
  workspaceId = `test-${randomUUID()}`;
  store = createDDBWorkspaceConfigAdapter({
    ddb,
    tableName: workspaceConfigTable,
    logger: silentLogger,
  });
});

async function seed(config: WorkspaceConfig): Promise<void> {
  const { ddb, workspaceConfigTable } = getLocalstack();
  await ddb.send(
    new PutCommand({
      TableName: workspaceConfigTable,
      Item: { ...config },
    }),
  );
}

describe("DDBWorkspaceConfigAdapter (integration)", () => {
  it("get returns the seeded workspace config", async () => {
    const config: WorkspaceConfig = {
      workspaceId,
      policyVersion: "v1",
      threshold: 0.5,
      maxZipDepth: 5,
      quarantineMacros: false,
      slipsheetRules: {},
      hashTtlDays: null,
    };
    await seed(config);

    const result = await store.get(workspaceId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(config);
  });

  it("get returns Result.error('not-found') for missing workspaceId", async () => {
    const result = await store.get(`nonexistent-${randomUUID()}`);
    expect(result).toEqual({ ok: false, error: "not-found" });
  });

  it("get handles complete config with all fields populated", async () => {
    const config: WorkspaceConfig = {
      workspaceId,
      policyVersion: "v2",
      threshold: 0.7,
      maxZipDepth: 10,
      quarantineMacros: true,
      slipsheetRules: { pdf: "always-slipsheet" },
      hashTtlDays: 90,
    };
    await seed(config);

    const result = await store.get(workspaceId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(config);
  });
});
