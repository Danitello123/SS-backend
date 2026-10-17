import { DataSource, getMetadataArgsStorage } from "typeorm";
import { FeeSchedule, FeeScheduleHistory } from "../../src/models/FeeSchedule.model";
import { IssuerReputation, IssuerReputationHistory } from "../../src/models/IssuerReputation.model";
import { InvestorRiskProfile } from "../../src/models/InvestorRiskProfile.model";
import { InvoiceDraft } from "../../src/models/InvoiceDraft.model";
import { User } from "../../src/models/User.model";
import { Invoice } from "../../src/models/Invoice.model";
import { Investment } from "../../src/models/Investment.model";
import { Transaction } from "../../src/models/Transaction.model";
import { KYCVerification } from "../../src/models/KYCVerification.model";
import { KycHistory } from "../../src/models/KycHistory.model";
import { Notification } from "../../src/models/Notification.model";
import { SecondaryListing } from "../../src/models/SecondaryListing.model";
import { Watchlist } from "../../src/models/Watchlist.model";

// Postgres-only column types (enum/jsonb/timestamptz) aren't in sqlite's
// supported type list, so TypeORM's metadata validator rejects them outright.
// Other integration tests in this repo work around it the same way: rewrite
// the column metadata in place before the sqlite DataSource is built.
function patchEntityMetadataForSQLite(): void {
  const columns = getMetadataArgsStorage().columns;
  for (const col of columns) {
    if (col.options.type === "timestamptz") {
      col.options.type = "datetime" as unknown as typeof col.options.type;
    }
    if (col.options.type === "jsonb") {
      col.options.type = "text" as unknown as typeof col.options.type;
    }
    if (col.options.type === "enum") {
      col.options.type = "varchar" as unknown as typeof col.options.type;
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
      User,
      Invoice,
      Investment,
      // Every entity User, Invoice, or Investment reference by string name in
      // a relation must be registered too, or TypeORM's metadata builder
      // fails to resolve the inverse side (even for tests that never touch
      // these tables).
      Transaction,
      KYCVerification,
      KycHistory,
      Notification,
      SecondaryListing,
      Watchlist,
    ],
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  return dataSource;
}
