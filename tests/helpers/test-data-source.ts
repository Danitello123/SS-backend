import { DataSource, getMetadataArgsStorage } from "typeorm";
import { FeeSchedule, FeeScheduleHistory } from "../../src/models/FeeSchedule.model";
import { IssuerReputation, IssuerReputationHistory } from "../../src/models/IssuerReputation.model";
import { InvestorRiskProfile } from "../../src/models/InvestorRiskProfile.model";
import { InvoiceDraft } from "../../src/models/InvoiceDraft.model";

function patchEntityMetadataForSQLite(): void {
  const columns = getMetadataArgsStorage().columns;
  for (const col of columns) {
    if (col.options.type === "timestamptz") {
      col.options.type = "datetime" as any;
    }
    if (col.options.type === "jsonb") {
      col.options.type = "text" as any;
    }
    if (col.options.type === "enum") {
      col.options.type = "varchar" as any;
    }
  }
}

export async function createTestDataSource(): Promise<DataSource> {
  patchEntityMetadataForSQLite();

  const dataSource = new DataSource({
    type: "sqlite",
    database: ":memory:",
    entities: [
      FeeSchedule,
      FeeScheduleHistory,
      IssuerReputation,
      IssuerReputationHistory,
      InvestorRiskProfile,
      InvoiceDraft,
    ],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  return dataSource;
}
