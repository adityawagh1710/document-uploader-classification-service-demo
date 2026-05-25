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

    // Component tag for cost slicing
    cdk.Tags.of(this).add("Component", "data");

    this.contentHashTable = contentHashTable;
    this.workspaceConfigTable = workspaceConfigTable;

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
  }
}
