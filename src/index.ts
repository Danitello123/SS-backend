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
import { createIssuerAnalyticsService } from "./services/issuer-analytics.service";
import { createDocumentExportService } from "./services/document-export.service";
import { createAutoInvestRuleEngineService } from "./services/auto-invest-rule-engine.service";
import { createAutoInvestRulesService } from "./services/auto-invest-rules.service";
import { HorizonAccountBalanceService } from "./services/stellar/account-balance.service";
import { getStellarNetworksConfig } from "./config/stellar-networks";
import { getPaymentVerificationConfig } from "./config/stellar";
import type { Invoice } from "./models/Invoice.model";

export async function bootstrap(): Promise<{ server: Server }> {
  const config = getConfig();

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  const authService = createAuthService(dataSource, config);
  const notificationService = createNotificationService(dataSource);
  const ipfsService = createIPFSService(config.ipfs, logger);

  const issuerAnalyticsService = createIssuerAnalyticsService(dataSource);
  const invalidateIssuerAnalytics = (sellerId: string) => issuerAnalyticsService.invalidate(sellerId);

  const investmentService = createInvestmentService(dataSource, invalidateIssuerAnalytics);
  const settlementService = createSettlementService(dataSource, invalidateIssuerAnalytics);

  const documentExportService = createDocumentExportService({
    dataSource,
    ipfsService,
    tempDir: config.documentExport.tempDir,
    signingSecret: config.documentExport.signingSecret,
    urlTtlMinutes: config.documentExport.urlTtlMinutes,
  });

  // Optional, like every other service above: an environment that hasn't
  // set MAINNET_HORIZON_URL/TESTNET_HORIZON_URL yet just runs without
  // X-Stellar-Network support instead of failing to boot.
  let stellarNetworksConfig;
  try {
    stellarNetworksConfig = getStellarNetworksConfig();
  } catch (error) {
    logger.warn("Stellar network selector disabled: networks config incomplete.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Auto-invest (issue #596) needs a Horizon URL to check wallet balances
  // before executing. Reuse whichever is already configured -- the
  // per-network table (#588) if present, else the single legacy
  // STELLAR_HORIZON_URL -- rather than requiring a third variable. Like
  // every other optional service, its absence disables auto-invest instead
  // of failing to boot.
  let onInvoicePublished: ((invoice: Invoice) => void) | undefined;
  try {
    const horizonUrl = stellarNetworksConfig?.mainnet.horizonUrl ?? getPaymentVerificationConfig().horizonUrl;
    const balanceChecker = new HorizonAccountBalanceService(horizonUrl);
    const autoInvestRuleEngine = createAutoInvestRuleEngineService({
      dataSource,
      investmentService,
      balanceChecker,
      logger,
    });
    onInvoicePublished = (invoice) => {
      void autoInvestRuleEngine.evaluateInvoice(invoice).catch((error) => {
        logger.error("Auto-invest evaluation failed", {
          invoice_id: invoice.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
  } catch (error) {
    logger.warn("Auto-invest rule engine disabled: no Horizon URL configured.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const invoiceService = createInvoiceService(dataSource, ipfsService, onInvoicePublished);
  const autoInvestRulesService = createAutoInvestRulesService(dataSource);

  const app = createApp({
    authService,
    notificationService,
    invoiceService,
    investmentService,
    settlementService,
    issuerAnalyticsService,
    documentExportService,
    autoInvestRulesService,
    stellarNetworksConfig,
    config,
    logger,
    metricsEnabled: config.observability.metricsEnabled,
  });

  const server = app.listen(config.port, () => {
    logger.info("Server running", { port: config.port });
  });

  return { server };
}

if (require.main === module) {
  bootstrap().catch((err) => {
    logger.error("Startup failed", { error: err });
    process.exit(1);
  });
}
