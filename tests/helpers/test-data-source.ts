import { DataSource } from "typeorm";
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

export async function createTestDataSource(): Promise<DataSource> {
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
