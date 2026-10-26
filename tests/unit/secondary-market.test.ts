import express from "express";
import request from "supertest";
import { Decimal } from "decimal.js";
import { SecondaryMarketService } from "../../src/services/secondary-market.service";
import { SecondaryMarketController } from "../../src/controllers/secondary-market.controller";
import { createSecondaryMarketRouter } from "../../src/routes/secondary-market.routes";
import {
  ListingStatus,
  InvoiceStatus,
  InvestmentStatus,
  TransactionType,
  TransactionStatus,
  UserType,
  KYCStatus,
} from "../../src/types/enums";
import type { AuthService } from "../../src/services/auth.service";
import { Invoice } from "../../src/models/Invoice.model";
import { Investment } from "../../src/models/Investment.model";
import { SecondaryListing } from "../../src/models/SecondaryListing.model";
import { Transaction } from "../../src/models/Transaction.model";

// ---------------------------------------------------------------------------
// In-Memory Test Fixtures & Fakes
// ---------------------------------------------------------------------------

const SELLER_ID = "seller-uuid-1";
const SELLER_WALLET = "GSELLER111111111111111111111111111111111111111111111111111";
const BUYER_ID = "buyer-uuid-2";
const BUYER_WALLET = "GBUYER2222222222222222222222222222222222222222222222222222";
const OTHER_USER_ID = "other-uuid-3";
const OTHER_WALLET = "GOTHER3333333333333333333333333333333333333333333333333333";

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-uuid-1",
    sellerId: "issuer-1",
    invoiceNumber: "INV-1001",
    customerName: "Acme Corp",
    amount: "1000.0000",
    discountRate: "5.00",
    netAmount: "950.0000",
    fundedAmount: "950.0000",
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days in future
    status: InvoiceStatus.FUNDED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Invoice;
}

function makeInvestment(overrides: Partial<Investment> = {}): Investment {
  return {
    id: "inv-uuid-1",
    invoiceId: "invoice-uuid-1",
    investorId: SELLER_ID,
    investorWallet: SELLER_WALLET,
    investmentAmount: "100.0000",
    expectedReturn: "105.0000",
    actualReturn: null,
    status: InvestmentStatus.CONFIRMED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Investment;
}

function makeListing(overrides: Partial<SecondaryListing> = {}): SecondaryListing {
  const listing = {
    id: "listing-uuid-1",
    invoiceId: "invoice-uuid-1",
    sellerWallet: SELLER_WALLET,
    sellerId: SELLER_ID,
    quantity: "50.0000",
    pricePerFraction: "1.1000",
    totalPrice: "55.0000",
    status: ListingStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    cancellationReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    invoice: makeInvoice(),
    isExpired: function (ref = new Date()): boolean {
      return new Date(this.expiresAt).getTime() < ref.getTime();
    },
    isActive: function (ref = new Date()): boolean {
      return this.status === ListingStatus.ACTIVE && !this.isExpired(ref);
    },
    ...overrides,
  };
  return listing as unknown as SecondaryListing;
}

function createFakeDataSource(state: {
  invoices?: Invoice[];
  investments?: Investment[];
  listings?: SecondaryListing[];
  transactions?: Transaction[];
}) {
  const invoices = state.invoices ?? [makeInvoice()];
  const investments = state.investments ?? [makeInvestment()];
  const listings = state.listings ?? [];
  const transactions = state.transactions ?? [];

  const manager = {
    findOne: jest.fn().mockImplementation(async (entityClass: any, options: any) => {
      const where = options?.where || {};
      if (entityClass === Invoice || entityClass?.name === "Invoice") {
        return invoices.find((inv) => inv.id === where.id) || null;
      }
      if (entityClass === Investment || entityClass?.name === "Investment") {
        return (
          investments.find(
            (inv) =>
              (!where.invoiceId || inv.invoiceId === where.invoiceId) &&
              (!where.investorId || inv.investorId === where.investorId) &&
              (!where.investorWallet || inv.investorWallet === where.investorWallet) &&
              (!where.status || inv.status === where.status)
          ) || null
        );
      }
      if (entityClass === SecondaryListing || entityClass?.name === "SecondaryListing") {
        return listings.find((l) => l.id === where.id) || null;
      }
      return null;
    }),
    find: jest.fn().mockImplementation(async (entityClass: any, options: any) => {
      const whereList = Array.isArray(options?.where) ? options.where : [options?.where || {}];
      if (entityClass === Investment || entityClass?.name === "Investment") {
        return investments.filter((inv) =>
          whereList.some(
            (where: any) =>
              (!where.invoiceId || inv.invoiceId === where.invoiceId) &&
              (!where.investorId || inv.investorId === where.investorId) &&
              (!where.investorWallet || inv.investorWallet === where.investorWallet) &&
              (!where.status || inv.status === where.status)
          )
        );
      }
      if (entityClass === SecondaryListing || entityClass?.name === "SecondaryListing") {
        return listings.filter((l) =>
          whereList.some(
            (where: any) =>
              (!where.invoiceId || l.invoiceId === where.invoiceId) &&
              (!where.sellerWallet || l.sellerWallet === where.sellerWallet) &&
              (!where.sellerId || l.sellerId === where.sellerId) &&
              (!where.status || l.status === where.status)
          )
        );
      }
      return [];
    }),
    create: jest.fn().mockImplementation((entityClass: any, props: any) => {
      const entity = { ...props, id: props.id || `id-${Date.now()}-${Math.random()}` };
      if (entityClass === SecondaryListing || entityClass?.name === "SecondaryListing") {
        entity.isExpired = function (ref = new Date()): boolean {
          return new Date(this.expiresAt).getTime() < ref.getTime();
        };
        entity.isActive = function (ref = new Date()): boolean {
          return this.status === ListingStatus.ACTIVE && !this.isExpired(ref);
        };
      }
      return entity;
    }),
    save: jest.fn().mockImplementation(async (entityClassOrEntity: any, maybeEntity?: any) => {
      const entity = maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
      if (entity.quantity !== undefined && entity.pricePerFraction !== undefined) {
        // It's a SecondaryListing
        const idx = listings.findIndex((l) => l.id === entity.id);
        if (idx >= 0) listings[idx] = entity;
        else listings.push(entity);
      } else if (entity.investmentAmount !== undefined) {
        // It's an Investment
        const idx = investments.findIndex((i) => i.id === entity.id);
        if (idx >= 0) investments[idx] = entity;
        else investments.push(entity);
      } else if (entity.amount !== undefined && entity.userId !== undefined) {
        // It's a Transaction
        transactions.push(entity);
      }
      return entity;
    }),
  };

  const getRepository = jest.fn().mockImplementation((entityClass: any) => ({
    findOne: manager.findOne.bind(null, entityClass),
    find: manager.find.bind(null, entityClass),
    save: manager.save.bind(null, entityClass),
    createQueryBuilder: jest.fn().mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest
        .fn()
        .mockResolvedValue(listings.filter((l) => l.status === ListingStatus.ACTIVE).length),
      getMany: jest
        .fn()
        .mockResolvedValue(listings.filter((l) => l.status === ListingStatus.ACTIVE)),
    }),
  }));

  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: typeof manager) => Promise<any>) => cb(manager)),
    getRepository,
  };

  return { dataSource, manager, invoices, investments, listings, transactions };
}

function buildTestApp(
  service: SecondaryMarketService,
  authConfig: { user?: any; rejectAuth?: boolean } = {}
) {
  const authService = {
    getCurrentUser: async (token: string) => {
      if (authConfig.rejectAuth || token === "invalid") {
        throw new Error("Invalid token");
      }
      if (token === "buyer") {
        return {
          id: BUYER_ID,
          stellarAddress: BUYER_WALLET,
          email: "buyer@test.com",
          userType: UserType.INVESTOR,
          kycStatus: KYCStatus.APPROVED,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      if (token === "other") {
        return {
          id: OTHER_USER_ID,
          stellarAddress: OTHER_WALLET,
          email: "other@test.com",
          userType: UserType.INVESTOR,
          kycStatus: KYCStatus.APPROVED,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      // Default to seller
      return (
        authConfig.user || {
          id: SELLER_ID,
          stellarAddress: SELLER_WALLET,
          email: "seller@test.com",
          userType: UserType.INVESTOR,
          kycStatus: KYCStatus.APPROVED,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      );
    },
  } as unknown as AuthService;

  const app = express();
  app.use(express.json());

  const router = createSecondaryMarketRouter({ secondaryMarketService: service, authService });
  app.use("/secondary-market", router);
  app.use("/api/v1/secondary-market", router);
  app.use("/api/v1/secondary", router);

  return app;
}

// ---------------------------------------------------------------------------
// Unit Tests: SecondaryMarketService
// ---------------------------------------------------------------------------

describe("SecondaryMarketService", () => {
  describe("createListing", () => {
    it("creates a resale listing successfully when seller owns confirmed shares", async () => {
      const invoice = makeInvoice();
      const fake = createFakeDataSource({ invoices: [invoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      const listing = await service.createListing({
        invoiceId: invoice.id,
        sellerWallet: SELLER_WALLET,
        sellerId: SELLER_ID,
        quantity: "40.0000",
        pricePerFraction: "1.2500",
      });

      expect(listing).toBeDefined();
      expect(listing.invoiceId).toBe(invoice.id);
      expect(listing.sellerWallet).toBe(SELLER_WALLET);
      expect(listing.quantity).toBe("40.0000");
      expect(listing.pricePerFraction).toBe("1.2500");
      expect(listing.totalPrice).toBe("50.0000");
      expect(listing.status).toBe(ListingStatus.ACTIVE);
      expect(new Date(listing.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("rejects listing creation if seller does not own shares in the invoice", async () => {
      const invoice = makeInvoice();
      const fake = createFakeDataSource({
        invoices: [invoice],
        investments: [], // No holdings
      });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: invoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "10.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "NO_HOLDINGS",
        statusCode: 400,
      });
    });

    it("rejects listing creation if quantity exceeds seller available unlisted holdings", async () => {
      const invoice = makeInvoice();
      // Seller owns 100 shares, and already has an active listing for 70 shares
      const existingListing = makeListing({ quantity: "70.0000", status: ListingStatus.ACTIVE });
      const fake = createFakeDataSource({
        invoices: [invoice],
        listings: [existingListing],
      });
      const service = new SecondaryMarketService(fake.dataSource as any);

      // Attempting to list 40 shares (only 30 unlisted remaining)
      await expect(
        service.createListing({
          invoiceId: invoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "40.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "INSUFFICIENT_HOLDINGS",
        statusCode: 400,
      });
    });

    it("rejects listing shares on a matured invoice with 422 (past due date)", async () => {
      const maturedInvoice = makeInvoice({
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day in past
      });
      const fake = createFakeDataSource({ invoices: [maturedInvoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: maturedInvoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "10.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "INVOICE_MATURED",
        statusCode: 422,
      });
    });

    it("rejects listing shares on a settled invoice with 422", async () => {
      const settledInvoice = makeInvoice({
        status: InvoiceStatus.SETTLED,
      });
      const fake = createFakeDataSource({ invoices: [settledInvoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: settledInvoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "10.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "INVOICE_MATURED",
        statusCode: 422,
      });
    });

    it("rejects listing shares on an invoice that is not funded (e.g. published) with 400", async () => {
      const publishedInvoice = makeInvoice({
        status: InvoiceStatus.PUBLISHED,
      });
      const fake = createFakeDataSource({ invoices: [publishedInvoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: publishedInvoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "10.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "INVALID_INVOICE_STATUS",
        statusCode: 400,
      });
    });

    it("rejects invalid quantity (<= 0) with 400", async () => {
      const invoice = makeInvoice();
      const fake = createFakeDataSource({ invoices: [invoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: invoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "0.0000",
          pricePerFraction: "1.0000",
        })
      ).rejects.toMatchObject({
        code: "INVALID_QUANTITY",
        statusCode: 400,
      });
    });

    it("rejects invalid price (<= 0) with 400", async () => {
      const invoice = makeInvoice();
      const fake = createFakeDataSource({ invoices: [invoice] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.createListing({
          invoiceId: invoice.id,
          sellerWallet: SELLER_WALLET,
          sellerId: SELLER_ID,
          quantity: "10.0000",
          pricePerFraction: "-1.0000",
        })
      ).rejects.toMatchObject({
        code: "INVALID_PRICE",
        statusCode: 400,
      });
    });
  });

  describe("buyListing", () => {
    it("rejects over-purchase beyond listing quantity with 409", async () => {
      const listing = makeListing({ quantity: "50.0000" });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.buyListing({
          listingId: listing.id,
          buyerWallet: BUYER_WALLET,
          buyerId: BUYER_ID,
          quantity: "50.0001",
        })
      ).rejects.toMatchObject({
        code: "OVER_PURCHASE",
        statusCode: 409,
      });
    });

    it("rejects self-purchase with 400", async () => {
      const listing = makeListing({ sellerWallet: SELLER_WALLET, sellerId: SELLER_ID });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.buyListing({
          listingId: listing.id,
          buyerWallet: SELLER_WALLET,
          buyerId: SELLER_ID,
          quantity: "10.0000",
        })
      ).rejects.toMatchObject({
        code: "SELF_PURCHASE",
        statusCode: 400,
      });
    });

    it("rejects purchase on an expired listing with 400", async () => {
      const listing = makeListing({
        expiresAt: new Date(Date.now() - 1000), // expired
      });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.buyListing({
          listingId: listing.id,
          buyerWallet: BUYER_WALLET,
          buyerId: BUYER_ID,
          quantity: "10.0000",
        })
      ).rejects.toMatchObject({
        code: "LISTING_EXPIRED",
        statusCode: 400,
      });
    });

    it("atomically transfers ownership with payment for a full purchase", async () => {
      const sellerInv = makeInvestment({ investmentAmount: "100.0000" });
      const listing = makeListing({ quantity: "50.0000", pricePerFraction: "2.0000" });
      const fake = createFakeDataSource({
        investments: [sellerInv],
        listings: [listing],
      });
      const service = new SecondaryMarketService(fake.dataSource as any);

      const result = await service.buyListing({
        listingId: listing.id,
        buyerWallet: BUYER_WALLET,
        buyerId: BUYER_ID,
        quantity: "50.0000",
      });

      expect(result.quantity).toBe("50.0000");
      expect(result.totalPrice).toBe("100.0000");

      // Listing is marked SOLD
      expect(listing.status).toBe(ListingStatus.SOLD);

      // Seller holding is reduced
      expect(sellerInv.investmentAmount).toBe("50.0000");

      // Buyer has received confirmed investment
      const buyerInv = fake.investments.find((i) => i.investorId === BUYER_ID);
      expect(buyerInv).toBeDefined();
      expect(buyerInv?.investmentAmount).toBe("50.0000");
      expect(buyerInv?.status).toBe(InvestmentStatus.CONFIRMED);

      // Payment transactions recorded
      const buyerTx = fake.transactions.find((t) => t.userId === BUYER_ID);
      expect(buyerTx).toBeDefined();
      expect(buyerTx?.amount).toBe("100.0000");
      expect(buyerTx?.status).toBe(TransactionStatus.COMPLETED);
    });

    it("atomically transfers ownership with payment for a partial purchase", async () => {
      const sellerInv = makeInvestment({ investmentAmount: "100.0000" });
      const listing = makeListing({ quantity: "50.0000", pricePerFraction: "2.0000" });
      const fake = createFakeDataSource({
        investments: [sellerInv],
        listings: [listing],
      });
      const service = new SecondaryMarketService(fake.dataSource as any);

      const result = await service.buyListing({
        listingId: listing.id,
        buyerWallet: BUYER_WALLET,
        buyerId: BUYER_ID,
        quantity: "20.0000",
      });

      expect(result.quantity).toBe("20.0000");
      expect(result.totalPrice).toBe("40.0000");

      // Listing quantity reduced, status remains ACTIVE
      expect(listing.status).toBe(ListingStatus.ACTIVE);
      expect(listing.quantity).toBe("30.0000");
      expect(listing.totalPrice).toBe("60.0000");

      // Seller holding reduced by 20
      expect(sellerInv.investmentAmount).toBe("80.0000");

      // Buyer credited with 20
      const buyerInv = fake.investments.find((i) => i.investorId === BUYER_ID);
      expect(buyerInv).toBeDefined();
      expect(buyerInv?.investmentAmount).toBe("20.0000");
    });
  });

  describe("cancelListing", () => {
    it("allows original seller to cancel their active listing", async () => {
      const listing = makeListing({ status: ListingStatus.ACTIVE });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      const cancelled = await service.cancelListing(
        listing.id,
        SELLER_WALLET,
        "Changed my mind",
        SELLER_ID
      );

      expect(cancelled.status).toBe(ListingStatus.CANCELLED);
      expect(cancelled.cancellationReason).toBe("Changed my mind");
    });

    it("rejects cancellation by a non-owner with 403 FORBIDDEN", async () => {
      const listing = makeListing({ status: ListingStatus.ACTIVE });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.cancelListing(listing.id, OTHER_WALLET, "Hacking", OTHER_USER_ID)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        statusCode: 403,
      });
    });

    it("rejects cancellation of an already sold or cancelled listing with 400", async () => {
      const listing = makeListing({ status: ListingStatus.SOLD });
      const fake = createFakeDataSource({ listings: [listing] });
      const service = new SecondaryMarketService(fake.dataSource as any);

      await expect(
        service.cancelListing(listing.id, SELLER_WALLET, "Too late", SELLER_ID)
      ).rejects.toMatchObject({
        code: "LISTING_NOT_ACTIVE",
        statusCode: 400,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP Endpoint Integration Tests
// ---------------------------------------------------------------------------

describe("Secondary Market HTTP Endpoints", () => {
  it("POST /secondary-market/listings creates a resale listing with price and quantity", async () => {
    const invoice = makeInvoice();
    const fake = createFakeDataSource({ invoices: [invoice] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .post("/secondary-market/listings")
      .set("Authorization", "Bearer valid")
      .send({
        invoiceId: invoice.id,
        quantity: "25.0000",
        price: "1.5000",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe("25.0000");
    expect(res.body.data.pricePerFraction).toBe("1.5000");
    expect(res.body.data.totalPrice).toBe("37.5000");
  });

  it("POST /secondary-market/listings rejects listing on matured invoice with 422", async () => {
    const maturedInvoice = makeInvoice({
      dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const fake = createFakeDataSource({ invoices: [maturedInvoice] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .post("/secondary-market/listings")
      .set("Authorization", "Bearer valid")
      .send({
        invoiceId: maturedInvoice.id,
        quantity: "25.0000",
        price: "1.5000",
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVOICE_MATURED");
  });

  it("GET /secondary-market/listings returns active listings per invoice", async () => {
    const invoice = makeInvoice();
    const listing = makeListing({ invoiceId: invoice.id });
    const fake = createFakeDataSource({ invoices: [invoice], listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app).get(`/secondary-market/listings?invoiceId=${invoice.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("POST /secondary-market/listings/:id/buy processes purchase and transfers ownership", async () => {
    const invoice = makeInvoice();
    const sellerInv = makeInvestment({ investmentAmount: "100.0000" });
    const listing = makeListing({
      invoiceId: invoice.id,
      quantity: "50.0000",
      pricePerFraction: "2.0000",
    });
    const fake = createFakeDataSource({
      invoices: [invoice],
      investments: [sellerInv],
      listings: [listing],
    });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .post(`/secondary-market/listings/${listing.id}/buy`)
      .set("Authorization", "Bearer buyer")
      .send({ quantity: "20.0000" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe("20.0000");
    expect(res.body.data.totalPrice).toBe("40.0000");
  });

  it("POST /secondary-market/listings/:id/buy rejects over-purchase with 409", async () => {
    const listing = makeListing({ quantity: "30.0000" });
    const fake = createFakeDataSource({ listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .post(`/secondary-market/listings/${listing.id}/buy`)
      .set("Authorization", "Bearer buyer")
      .send({ quantity: "35.0000" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OVER_PURCHASE");
  });

  it("DELETE /secondary-market/listings/:id allows seller to cancel listing", async () => {
    const listing = makeListing({ status: ListingStatus.ACTIVE });
    const fake = createFakeDataSource({ listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .delete(`/secondary-market/listings/${listing.id}`)
      .set("Authorization", "Bearer valid")
      .send({ reason: "Price too low" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(ListingStatus.CANCELLED);
  });

  it("POST /secondary-market/listings/:id/cancel allows seller to cancel listing (POST alias)", async () => {
    const listing = makeListing({ status: ListingStatus.ACTIVE });
    const fake = createFakeDataSource({ listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .post(`/secondary-market/listings/${listing.id}/cancel`)
      .set("Authorization", "Bearer valid")
      .send({ reason: "Cancelling via POST" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(ListingStatus.CANCELLED);
  });

  it("Cancel listing rejects non-owner with 403", async () => {
    const listing = makeListing({ status: ListingStatus.ACTIVE });
    const fake = createFakeDataSource({ listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res = await request(app)
      .delete(`/secondary-market/listings/${listing.id}`)
      .set("Authorization", "Bearer other")
      .send({ reason: "Attempted hijack" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("Works identically across /api/v1/secondary-market and /api/v1/secondary", async () => {
    const invoice = makeInvoice();
    const listing = makeListing({ invoiceId: invoice.id });
    const fake = createFakeDataSource({ invoices: [invoice], listings: [listing] });
    const service = new SecondaryMarketService(fake.dataSource as any);
    const app = buildTestApp(service);

    const res1 = await request(app).get(`/api/v1/secondary-market/listings`);
    expect(res1.status).toBe(200);

    const res2 = await request(app).get(`/api/v1/secondary/listings`);
    expect(res2.status).toBe(200);
  });
});
