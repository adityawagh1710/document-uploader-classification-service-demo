import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { NagSuppressions } from "cdk-nag";
import type { EnvConfig } from "../config/types.js";

export interface DataStackProps extends cdk.StackProps {
  readonly envConfig: EnvConfig;
}

export class ClassificationDataStack extends cdk.Stack {
  readonly contentHashTable: dynamodb.ITable;
  readonly workspaceConfigTable: dynamodb.ITable;
  readonly classificationsTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: props.envConfig.envName === "prod",
    });

    const env = props.envConfig.envName;
    const removalPolicy = env === "prod" ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // content-hashes table (per U-2 IaD §2)
    const contentHashTable = new dynamodb.Table(this, "ContentHashes", {
      tableName: env === "prod" ? "content-hashes" : `content-hashes-${env}`,
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "contentHash", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: props.envConfig.pitrEnabledContentHashes,
      },
      timeToLiveAttribute: "expiresAt",
      deletionProtection: props.envConfig.deletionProtectionEnabled,
      removalPolicy,
      contributorInsightsEnabled: true,
    });

    // workspace-config table (per U-2 IaD §3)
    const workspaceConfigTable = new dynamodb.Table(this, "WorkspaceConfig", {
      tableName: env === "prod" ? "workspace-config" : `workspace-config-${env}`,
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      deletionProtection: props.envConfig.deletionProtectionEnabled,
      removalPolicy,
      contributorInsightsEnabled: true,
    });

    // cdk-nag suppression for workspace-config (no PITR per Q2=A of U-2 IaD)
    NagSuppressions.addResourceSuppressions(workspaceConfigTable, [
      {
        id: "AwsSolutions-DDB3",
        reason:
          "Workspace config is small (~hundreds of rows) and source-of-truth managed externally; " +
          "PITR overhead not justified. Per U-2 IaD Q2=A.",
      },
    ]);

    // classifications table — per-upload dashboard activity log (UI-owned, NOT
    // touched by the Lambda). One row per classify attempt (success, duplicate,
    // or failure), keyed for newest-first Query: PK=workspaceId, SK=runId
    // (`<ISO-ts>#<documentId>`, lexically chronological). Holds the full result
    // + the S3 object reference (s3Bucket/s3Key) + a presign target. TTL-bounded
    // via `expiresAt` so the sandbox log self-prunes.
    const classificationsTable = new dynamodb.Table(this, "Classifications", {
      tableName: env === "prod" ? "classifications" : `classifications-${env}`,
      partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "runId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      timeToLiveAttribute: "expiresAt",
      deletionProtection: props.envConfig.deletionProtectionEnabled,
      removalPolicy,
      contributorInsightsEnabled: true,
    });

    // cdk-nag suppression for classifications (no PITR — ephemeral, TTL-bounded
    // dashboard activity log; not a system of record).
    NagSuppressions.addResourceSuppressions(classificationsTable, [
      {
        id: "AwsSolutions-DDB3",
        reason:
          "Classifications is an ephemeral, TTL-bounded UI activity log (not a system of record). " +
          "PITR overhead not justified.",
      },
    ]);

    // Component tag for cost slicing
    cdk.Tags.of(this).add("Component", "data");

    this.contentHashTable = contentHashTable;
    this.workspaceConfigTable = workspaceConfigTable;
    this.classificationsTable = classificationsTable;

    // Cross-stack exports
    new cdk.CfnOutput(this, "ContentHashTableName", {
      value: contentHashTable.tableName,
      exportName: `ClassificationContentHashTableName-${env}`,
    });
    new cdk.CfnOutput(this, "ContentHashTableArn", {
      value: contentHashTable.tableArn,
      exportName: `ClassificationContentHashTableArn-${env}`,
    });
    new cdk.CfnOutput(this, "WorkspaceConfigTableName", {
      value: workspaceConfigTable.tableName,
      exportName: `ClassificationWorkspaceConfigTableName-${env}`,
    });
    new cdk.CfnOutput(this, "WorkspaceConfigTableArn", {
      value: workspaceConfigTable.tableArn,
      exportName: `ClassificationWorkspaceConfigTableArn-${env}`,
    });
    new cdk.CfnOutput(this, "ClassificationsTableName", {
      value: classificationsTable.tableName,
      exportName: `ClassificationClassificationsTableName-${env}`,
    });
    new cdk.CfnOutput(this, "ClassificationsTableArn", {
      value: classificationsTable.tableArn,
      exportName: `ClassificationClassificationsTableArn-${env}`,
    });
  }
}
