import type { Server } from "http";

import { createApp } from "./app";

import dataSource from "./config/database";
import { getConfig } from "./config/env";
import { logger } from "./observability/logger";

import { createAuthService } from "./services/auth.service";
import { createNotificationService } from "./services/notification.service";
import { createInvoiceService } from "./services/invoice.service";
import { createIPFSService } from "./services/ipfs.service";
import { createInvestmentService } from "./services/investment.service";
import { createSettlementService } from "./services/settlement.service";
import { createMarketplaceService } from "./services/marketplace.service";
import { KycService } from "./services/kyc.service";
import { PaymentDistributorContractService } from "./services/stellar/payment-distributor-contract.service";
import { getSorobanConfig } from "./config/stellar";
import { EventIndexerService } from "./services/stellar/event-indexer.service";
import { createInvestorInsightsService } from "./services/investor-insights.service";

export async function bootstrap(): Promise<{ server: Server }> {
  const config = getConfig();

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const authService = createAuthService(dataSource, config, logger);
  const notificationService = createNotificationService(dataSource);
  const ipfsService = createIPFSService(config.ipfs, logger);
  const invoiceService = createInvoiceService(dataSource, ipfsService, notificationService);
  const investmentService = createInvestmentService(dataSource);
  const sorobanConfig = getSorobanConfig();
  const investorInsightsService = createInvestorInsightsService(
    dataSource,
    {
      notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL,
      notificationServiceToken: process.env.NOTIFICATION_SERVICE_TOKEN,
      bonusPoolContractId: process.env.ONBOARDING_BONUS_CONTRACT_ID,
      bonusPoolStorageKey: process.env.ONBOARDING_BONUS_POOL_STORAGE_KEY,
      rpcUrl: sorobanConfig.rpcUrl,
    },
    logger,
  );
  const indexerContractIds = (process.env.SOROBAN_INDEXER_CONTRACT_IDS ?? "")
    .split(",")
    .map((contractId) => contractId.trim())
    .filter(Boolean);
  const eventIndexer = indexerContractIds.length > 0
    ? new EventIndexerService({
      contractIds: indexerContractIds,
      rpcUrl: sorobanConfig.rpcUrl,
      dataSource,
      logger,
      investorInsightsService,
    })
    : undefined;
  eventIndexer?.start();
  const distributor = sorobanConfig.paymentDistributorContractId && sorobanConfig.platformSecretKey
    ? new PaymentDistributorContractService({ ...sorobanConfig, contractId: sorobanConfig.paymentDistributorContractId }, logger)
    : undefined;
  const distributorConfig = distributor && sorobanConfig.platformFeeRecipient
    ? { feeRecipient: sorobanConfig.platformFeeRecipient, feeBps: sorobanConfig.platformFeeBps }
    : undefined;
  const settlementService = createSettlementService(dataSource, distributor, distributorConfig);
  const marketplaceService = createMarketplaceService(dataSource);
  const kycService = new KycService(dataSource, config.kyc.webhookSecret ?? "", logger);

  const app = createApp({
    authService,
    notificationService,
    invoiceService,
    investmentService,
    settlementService,
    marketplaceService,
    kycService,
    investorInsightsService,
    config,
    logger,
    metricsEnabled: config.observability.metricsEnabled,
  });

  const server = app.listen(config.port, () => {
    logger.info("Server running", { port: config.port });
  });
  server.on("close", () => eventIndexer?.stop());

  return { server };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error("Startup failed", { error: err });
    process.exit(1);
  });
}
