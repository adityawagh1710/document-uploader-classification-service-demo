import type { WorkspaceConfig } from "../shared/types.js";
import type { Result } from "../shared/result.js";
import type { StoreError } from "./ContentHashStore.js";

export interface WorkspaceConfigStore {
  get(workspaceId: string): Promise<Result<WorkspaceConfig, StoreError>>;
}
