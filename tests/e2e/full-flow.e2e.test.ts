/**
 * E2E Test: Complete Invoice Financing Flow
 *
 * This test validates the entire product journey:
 * 1. Seller and Investor registration/authentication via Stellar challenge-response
 * 2. Seller creates and publishes an invoice
 * 3. Investor views marketplace and invests
 * 4. Investment is confirmed (simulating Horizon verification)
 * 5. Invoice is settled with pro-rata distribution
 *
 * External services (Stellar Horizon, IPFS) are mocked.
 * Uses SQLite in-memory database for test isolation.
 *
 * Flow tested: register/auth → create invoice → publish → marketplace list →
 * invest → verify (confirm) → settle
 */

import "reflect-metadata";
import request from "supertest";
import { DataSource, getMetadataArgsStorage } from "typeorm";
import { Keypair } from "stellar-sdk";
import { createApp } from "../../src/app";
import { createAuthService } from "../../src/services/auth.service";
import { createInvoiceService } from "../../src/services/invoice.service";
import { createInvestmentService } from "../../src/services/investment.service";
import { createSettlementService } from "../../src/services/settlement.service";
import { createMarketplaceService } from "../../src/services/marketplace.service";
import { createNotificationService } from "../../src/services/notification.service";
import type { IPFSService, IPFSUploadResult } from "../../src/services/ipfs.service";
import { User } from "../../src/models/User.model";
import { Investment } from "../../src/models/Investment.model";
import { Invoice } from "../../src/models/Invoice.model";
import { AuthChallenge } from "../../src/models/AuthChallenge.model";
import { Transaction } from "../../src/models/Transaction.model";
import { KYCVerification } from "../../src/models/KYCVerification.model";
import { Notification } from "../../src/models/Notification.model";
import { InvoiceStatus, InvestmentStatus, KYCStatus } from "../../src/types/enums";
import type { AppConfig } from "../../src/config/env";
import { logger } from "../../src/observability/logger";

// Mock IPFS service that returns deterministic hashes
const mockIPFSService = {
  async uploadFile(
    _fileBuffer: Buffer,
    _filename: string,
    _mimeType: string,
    _invoiceId?: string
  ): Promise<IPFSUploadResult> {
    return {
      hash: "QmMockHash1234567890123456789012345678901234567890",
      size: 1024,
      timestamp: new Date().toISOString(),
    };
  },
} as unknown as IPFSService;

/**
 * Patch entity metadata for SQLite compatibility.
 * SQLite does not support PostgreSQL-specific types (timestamptz, jsonb, enum).
 * We remap them to SQLite-compatible equivalents before DataSource init.
 */
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

/**
 * Normalize a decimal value that may come back from SQLite as a number
 * or from PostgreSQL as a string, into a comparable numeric value.
 */
function toNum(val: unknown): number {
  return Number(val);
}

describe("E2E: Complete Invoice Financing Flow", () => {
  let dataSource: DataSource;
  let app: ReturnType<typeof createApp>;
  let config: AppConfig;

  // Test keypairs
  let sellerKeypair: Keypair;
  let investorKeypair: Keypair;
  let sellerToken: string;
  let investorToken: string;
  let sellerId: string;
  let investorId: string;
  let invoiceId: string;
  let investmentId: string;

  beforeAll(async () => {
    // Generate Stellar keypairs for seller and investor
    sellerKeypair = Keypair.random();
    investorKeypair = Keypair.random();

    // Set environment variables required by middleware that reads from process.env
    process.env.JWT_SECRET = "test-jwt-secret-key-for-e2e-tests-only";
    process.env.ADMIN_API_KEY = "test-admin-key";
    process.env.SKIP_KYC_VERIFICATION = "true";

    // Create test configuration
    config = {
      port: 3000,
      nodeEnv: "test",
      jwt: {
        secret: "test-jwt-secret-key-for-e2e-tests-only",
        expiresIn: "1h",
      },
      auth: {
        challengeTtlMs: 5 * 60 * 1000,
      },
      observability: {
        metricsEnabled: false,
      },
      http: {
        trustProxy: false,
        corsAllowedOrigins: [],
        corsAllowCredentials: false,
        bodySizeLimit: "1mb",
        shutdownTimeoutMs: 15000,
        rateLimit: {
          enabled: false,
          windowMs: 60000,
          max: 1000,
        },
      },
      reconciliation: {
        enabled: false,
        intervalMs: 30000,
        batchSize: 25,
        gracePeriodMs: 60000,
        maxRuntimeMs: 10000,
      },
      stellar: {
        network: "testnet",
        networkPassphrase: "Test SDF Network ; September 2015",
      },
      sorobanEscrow: {
        enabled: false,
        contractId: null,
        fundingMode: "wallet_xdr",
        rpcUrl: "https://soroban-testnet.stellar.org",
      },
      ipfs: {
        apiUrl: "https://api.pinata.cloud",
        jwt: "mock-pinata-jwt",
        maxFileSizeMB: 10,
        allowedMimeTypes: ["application/pdf", "image/jpeg"],
        uploadRateLimit: {
          windowMs: 900000,
          maxUploads: 10,
        },
      },
      kyc: {
        skipVerification: true,
      },
      admin: {
        ipWhitelist: [],
      },
    };

    // Initialize test database (SQLite in-memory)
    patchEntityMetadataForSQLite();

    dataSource = new DataSource({
      type: "sqlite",
      database: ":memory:",
      synchronize: true,
      logging: false,
      entities: [User, Invoice, Investment, AuthChallenge, Transaction, KYCVerification, Notification],
    });

    await dataSource.initialize();

    // Create services with mocked IPFS
    const authService = createAuthService(dataSource, config);
    const invoiceService = createInvoiceService(dataSource, mockIPFSService);
    const investmentService = createInvestmentService(dataSource);
    const settlementService = createSettlementService(dataSource);
    const marketplaceService = createMarketplaceService(dataSource);
    const notificationService = createNotificationService(dataSource);

    // Create the full app
    app = createApp({
      authService,
      notificationService,
      invoiceService,
      investmentService,
      settlementService,
      marketplaceService,
      config,
      logger,
      metricsEnabled: false,
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  // ============================================================
  // Step 1: Authentication
  // ============================================================
  describe("Step 1: Authentication", () => {
    it("should authenticate seller via Stellar challenge-response", async () => {
      // Request challenge
      const challengeRes = await request(app)
        .post("/api/v1/auth/challenge")
        .send({ publicKey: sellerKeypair.publicKey() })
        .expect(201);

      expect(challengeRes.body.challenge).toBeDefined();
      expect(challengeRes.body.challenge.publicKey).toBe(sellerKeypair.publicKey());
      expect(challengeRes.body.challenge.nonce).toBeDefined();
      expect(challengeRes.body.challenge.message).toBeDefined();

      const { nonce, message } = challengeRes.body.challenge;

      // Sign the challenge message
      const signature = sellerKeypair
        .sign(Buffer.from(message, "utf8"))
        .toString("hex");

      // Verify challenge and get token
      const verifyRes = await request(app)
        .post("/api/v1/auth/verify")
        .send({
          publicKey: sellerKeypair.publicKey(),
          nonce,
          signature,
        })
        .expect(200);

      expect(verifyRes.body.token).toBeDefined();
      expect(verifyRes.body.tokenType).toBe("Bearer");
      expect(verifyRes.body.user).toBeDefined();
      expect(verifyRes.body.user.stellarAddress).toBe(sellerKeypair.publicKey());

      sellerToken = verifyRes.body.token;
      sellerId = verifyRes.body.user.id;
    });

    it("should authenticate investor via Stellar challenge-response", async () => {
      const challengeRes = await request(app)
        .post("/api/v1/auth/challenge")
        .send({ publicKey: investorKeypair.publicKey() })
        .expect(201);

      const { nonce, message } = challengeRes.body.challenge;

      const signature = investorKeypair
        .sign(Buffer.from(message, "utf8"))
        .toString("hex");

      const verifyRes = await request(app)
        .post("/api/v1/auth/verify")
        .send({
          publicKey: investorKeypair.publicKey(),
          nonce,
          signature,
        })
        .expect(200);

      investorToken = verifyRes.body.token;
      investorId = verifyRes.body.user.id;
    });

    it("should set KYC status to APPROVED for investor (required for investments)", async () => {
      // In production this is done via admin KYC approval.
      // For E2E, we update the database directly.
      const userRepo = dataSource.getRepository(User);
      await userRepo.update(investorId, { kycStatus: KYCStatus.APPROVED });

      const user = await userRepo.findOneBy({ id: investorId });
      expect(user?.kycStatus).toBe(KYCStatus.APPROVED);
    });

    it("should set KYC status to APPROVED for seller (required for publishing invoices)", async () => {
      const userRepo = dataSource.getRepository(User);
      await userRepo.update(sellerId, { kycStatus: KYCStatus.APPROVED });

      const user = await userRepo.findOneBy({ id: sellerId });
      expect(user?.kycStatus).toBe(KYCStatus.APPROVED);
    });
  });

  // ============================================================
  // Step 2: Invoice Creation and Publishing
  // ============================================================
  describe("Step 2: Invoice Creation and Publishing", () => {
    it("should create a new invoice as seller", async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);

      const createRes = await request(app)
        .post("/api/v1/invoices")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          invoiceNumber: "INV-E2E-001",
          customerName: "Test Customer Corp",
          amount: "10000.0000",
          discountRate: "5.00",
          dueDate: dueDate.toISOString(),
          riskScore: "25.00",
        })
        .expect(201);

      expect(createRes.body.success).toBe(true);
      expect(createRes.body.data).toBeDefined();
      expect(createRes.body.data.invoiceNumber).toBe("INV-E2E-001");
      expect(createRes.body.data.customerName).toBe("Test Customer Corp");

      // Use numeric comparison (SQLite may return numbers without trailing zeros)
      expect(toNum(createRes.body.data.amount)).toBeCloseTo(10000, 2);
      expect(toNum(createRes.body.data.discountRate)).toBeCloseTo(5, 2);
      expect(toNum(createRes.body.data.netAmount)).toBeCloseTo(9500, 2);
      expect(createRes.body.data.status).toBe(InvoiceStatus.DRAFT);
      expect(createRes.body.data.sellerId).toBe(sellerId);

      invoiceId = createRes.body.data.id;
      expect(invoiceId).toBeDefined();
    });

    it("should upload document to IPFS (mocked)", async () => {
      expect(invoiceId).toBeDefined();

      const uploadRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/document`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .attach("document", Buffer.from("mock pdf content"), "invoice.pdf")
        .expect(200);

      expect(uploadRes.body.success).toBe(true);
      expect(uploadRes.body.data.ipfsHash).toBe(
        "QmMockHash1234567890123456789012345678901234567890"
      );
      expect(uploadRes.body.data.invoiceId).toBe(invoiceId);
    });

    it("should publish the invoice", async () => {
      expect(invoiceId).toBeDefined();

      const publishRes = await request(app)
        .post(`/api/v1/invoices/${invoiceId}/publish`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .expect(200);

      expect(publishRes.body.success).toBe(true);
      expect(publishRes.body.data.status).toBe(InvoiceStatus.PUBLISHED);
      expect(publishRes.body.data.id).toBe(invoiceId);
    });

    it("should verify invoice status in database", async () => {
      const invoiceRepo = dataSource.getRepository(Invoice);
      const invoice = await invoiceRepo.findOneBy({ id: invoiceId });

      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe(InvoiceStatus.PUBLISHED);
      expect(invoice?.sellerId).toBe(sellerId);
      expect(invoice?.ipfsHash).toBe(
        "QmMockHash1234567890123456789012345678901234567890"
      );
    });
  });

  // ============================================================
  // Step 3: Marketplace Listing
  // ============================================================
  describe("Step 3: Marketplace Listing", () => {
    it("should list published invoices in marketplace", async () => {
      const marketplaceRes = await request(app)
        .get("/api/v1/marketplace/invoices")
        .query({ page: "1", limit: "10" })
        .expect(200);

      expect(marketplaceRes.body.data).toBeDefined();
      expect(Array.isArray(marketplaceRes.body.data)).toBe(true);
      expect(marketplaceRes.body.data.length).toBeGreaterThan(0);

      const listedInvoice = marketplaceRes.body.data.find(
        (inv: any) => inv.id === invoiceId
      );
      expect(listedInvoice).toBeDefined();
      expect(listedInvoice.invoiceNumber).toBe("INV-E2E-001");
      expect(toNum(listedInvoice.amount)).toBeCloseTo(10000, 2);
      expect(toNum(listedInvoice.netAmount)).toBeCloseTo(9500, 2);
      expect(listedInvoice.status).toBe(InvoiceStatus.PUBLISHED);

      // Verify sensitive fields are not exposed in marketplace
      expect(listedInvoice.sellerId).toBeUndefined();
      expect(listedInvoice.ipfsHash).toBeUndefined();
      expect(listedInvoice.riskScore).toBeUndefined();
    });
  });

  // ============================================================
  // Step 4: Investment Creation
  // ============================================================
  describe("Step 4: Investment Creation", () => {
    it("should create investment as investor", async () => {
      const investRes = await request(app)
        .post("/api/v1/investments")
        .set("Authorization", `Bearer ${investorToken}`)
        .send({
          invoiceId,
          investmentAmount: "9500.0000",
        })
        .expect(201);

      expect(investRes.body.success).toBe(true);
      expect(investRes.body.data).toBeDefined();
      expect(investRes.body.data.invoiceId).toBe(invoiceId);
      expect(investRes.body.data.investorId).toBe(investorId);
      expect(toNum(investRes.body.data.investmentAmount)).toBeCloseTo(9500, 2);
      expect(investRes.body.data.status).toBe(InvestmentStatus.PENDING);
      expect(investRes.body.data.expectedReturn).toBeDefined();

      investmentId = investRes.body.data.id;
      expect(investmentId).toBeDefined();

      // expectedReturn = investmentAmount * (faceValue / netAmount)
      // = 9500 * (10000 / 9500) = 10000
      expect(toNum(investRes.body.data.expectedReturn)).toBeCloseTo(10000, 2);
    });

    it("should transition invoice to FUNDED when fully subscribed", async () => {
      const invoiceRepo = dataSource.getRepository(Invoice);
      const invoice = await invoiceRepo.findOneBy({ id: invoiceId });

      expect(invoice?.status).toBe(InvoiceStatus.FUNDED);
    });

    it("should verify investment in database", async () => {
      const investmentRepo = dataSource.getRepository(Investment);
      const investment = await investmentRepo.findOneBy({ id: investmentId });

      expect(investment).toBeDefined();
      expect(investment?.invoiceId).toBe(invoiceId);
      expect(investment?.investorId).toBe(investorId);
      expect(toNum(investment?.investmentAmount)).toBeCloseTo(9500, 2);
      expect(investment?.status).toBe(InvestmentStatus.PENDING);
    });
  });

  // ============================================================
  // Step 5: Investment Confirmation (simulates Horizon verification)
  // ============================================================
  describe("Step 5: Investment Confirmation (Horizon Mock)", () => {
    it("should confirm investment (simulating Stellar Horizon verification)", async () => {
      expect(investmentId).toBeDefined();

      // In production, the reconciliation worker watches Horizon for on-chain
      // transactions and marks investments as CONFIRMED.
      // For E2E, we simulate this by updating the status directly.
      const investmentRepo = dataSource.getRepository(Investment);
      await investmentRepo.update(investmentId, {
        status: InvestmentStatus.CONFIRMED,
        transactionHash: "mock_stellar_tx_hash_e2e_12345",
        stellarOperationIndex: 1,
      });

      const investment = await investmentRepo.findOneBy({ id: investmentId });
      expect(investment?.status).toBe(InvestmentStatus.CONFIRMED);
      expect(investment?.transactionHash).toBe("mock_stellar_tx_hash_e2e_12345");
    });
  });

  // ============================================================
  // Step 6: Settlement
  // ============================================================
  describe("Step 6: Settlement", () => {
    it("should settle the funded invoice", async () => {
      const settleRes = await request(app)
        .post(`/api/v1/settlements/${invoiceId}`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          proceeds: "10000.0000",
        })
        .expect(200);

      expect(settleRes.body.success).toBe(true);
      expect(settleRes.body.data).toBeDefined();
      expect(settleRes.body.data.invoiceId).toBe(invoiceId);
      expect(settleRes.body.data.status).toBe(InvoiceStatus.SETTLED);
      expect(toNum(settleRes.body.data.proceeds)).toBeCloseTo(10000, 2);
      expect(settleRes.body.data.settlements).toBeDefined();
      expect(Array.isArray(settleRes.body.data.settlements)).toBe(true);
      expect(settleRes.body.data.settlements.length).toBe(1);

      const settlement = settleRes.body.data.settlements[0];
      expect(settlement.investmentId).toBe(investmentId);
      expect(settlement.investorId).toBe(investorId);
      expect(toNum(settlement.investmentAmount)).toBeCloseTo(9500, 2);

      // Investor funded 100% so gets 100% of proceeds
      expect(toNum(settlement.actualReturn)).toBeCloseTo(10000, 2);
    });

    it("should transition invoice to SETTLED in database", async () => {
      const invoiceRepo = dataSource.getRepository(Invoice);
      const invoice = await invoiceRepo.findOneBy({ id: invoiceId });

      expect(invoice?.status).toBe(InvoiceStatus.SETTLED);
    });

    it("should transition investment to SETTLED in database", async () => {
      const investmentRepo = dataSource.getRepository(Investment);
      const investment = await investmentRepo.findOneBy({ id: investmentId });

      expect(investment?.status).toBe(InvestmentStatus.SETTLED);
      expect(investment?.actualReturn).toBeDefined();
      expect(toNum(investment?.actualReturn ?? "0")).toBeCloseTo(10000, 2);
    });

    it("should verify investor dashboard reflects settled investment", async () => {
      const dashboardRes = await request(app)
        .get("/api/v1/investments/dashboard")
        .set("Authorization", `Bearer ${investorToken}`)
        .expect(200);

      expect(dashboardRes.body.success).toBe(true);
      expect(dashboardRes.body.data).toBeDefined();
      expect(toNum(dashboardRes.body.data.totalInvested)).toBeCloseTo(9500, 2);
      expect(toNum(dashboardRes.body.data.totalReturns)).toBeCloseTo(10000, 2);
      expect(dashboardRes.body.data.activeInvestments).toBe(0);
    });
  });

  // ============================================================
  // Step 7: Post-Settlement Verification
  // ============================================================
  describe("Step 7: Post-Settlement Verification", () => {
    it("should prevent updating a settled invoice", async () => {
      const res = await request(app)
        .put(`/api/v1/invoices/${invoiceId}`)
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({ amount: "15000.0000" });

      // Should fail because invoice is settled (cannot update non-draft invoices)
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should prevent investing in a settled invoice", async () => {
      const res = await request(app)
        .post("/api/v1/investments")
        .set("Authorization", `Bearer ${investorToken}`)
        .send({
          invoiceId,
          investmentAmount: "1000.0000",
        });

      // Should fail because invoice is no longer in PUBLISHED status
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should verify complete flow integrity", async () => {
      const invoiceRepo = dataSource.getRepository(Invoice);
      const investmentRepo = dataSource.getRepository(Investment);

      const invoice = await invoiceRepo.findOneBy({ id: invoiceId });
      const investment = await investmentRepo.findOneBy({ id: investmentId });

      // Status transitions
      expect(invoice?.status).toBe(InvoiceStatus.SETTLED);
      expect(investment?.status).toBe(InvestmentStatus.SETTLED);

      // Financial calculations
      const investedAmount = toNum(investment?.investmentAmount ?? "0");
      const actualReturn = toNum(investment?.actualReturn ?? "0");
      const expectedReturn = toNum(investment?.expectedReturn ?? "0");

      expect(investedAmount).toBeCloseTo(9500, 2);
      expect(actualReturn).toBeCloseTo(10000, 2);
      expect(expectedReturn).toBeCloseTo(10000, 2);

      // Profit
      const profit = actualReturn - investedAmount;
      expect(profit).toBeCloseTo(500, 2);
    });
  });
});
