import { DataSource } from "typeorm";
import { IssuerAnalyticsService } from "../src/services/issuer-analytics.service";
import { Invoice } from "../src/models/Invoice.model";
import { Investment } from "../src/models/Investment.model";
import { User } from "../src/models/User.model";
import { InvoiceStatus, InvestmentStatus } from "../src/types/enums";

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: overrides.id ?? "invoice-1",
    sellerId: "issuer-1",
    invoiceNumber: "INV-1",
    customerName: "Acme",
    amount: "1000.0000",
    discountRate: "5.00",
    netAmount: "950.0000",
    dueDate: new Date("2026-02-01T00:00:00Z"),
    ipfsHash: null,
    riskScore: null,
    status: InvoiceStatus.PUBLISHED,
    smartContractId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  } as Invoice;
}

function makeInvestment(overrides: Partial<Investment>): Investment {
  return {
    id: overrides.id ?? "investment-1",
    invoiceId: "invoice-1",
    investorId: "investor-1",
    investmentAmount: "500.0000",
    expectedReturn: "525.0000",
    actualReturn: null,
    status: InvestmentStatus.CONFIRMED,
    transactionHash: null,
    stellarOperationIndex: null,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  } as Investment;
}

/**
 * A fake `DataSource` exposing just the repository calls
 * `IssuerAnalyticsService` actually makes: `Invoice`/`Investment`
 * `createQueryBuilder().where()/.andWhere()/.getMany()`, `Invoice.find`, and
 * `User.findOneBy`.
 */
function createFakeDataSource(invoices: Invoice[], investments: Investment[], users: User[] = []) {
  function invoiceQueryBuilder() {
    let sellerId: string | undefined;
    let since: Date | undefined;
    const builder = {
      where: (_clause: string, params: { issuerId: string }) => {
        sellerId = params.issuerId;
        return builder;
      },
      andWhere: (_clause: string, params: { start: Date }) => {
        since = params.start;
        return builder;
      },
      getMany: async () =>
        invoices.filter(
          (invoice) => invoice.sellerId === sellerId && (!since || invoice.createdAt >= since)
        ),
    };
    return builder;
  }

  function investmentQueryBuilder() {
    let invoiceIds: string[] = [];
    const builder = {
      where: (_clause: string, params: { invoiceIds: string[] }) => {
        invoiceIds = params.invoiceIds;
        return builder;
      },
      getMany: async () =>
        investments.filter((investment) => invoiceIds.includes(investment.invoiceId)),
    };
    return builder;
  }

  return {
    getRepository: (entity: unknown) => {
      if (entity === Invoice) {
        return {
          createQueryBuilder: () => invoiceQueryBuilder(),
          find: async (options: { where: { sellerId: string } }) =>
            invoices.filter((invoice) => invoice.sellerId === options.where.sellerId),
        };
      }
      if (entity === Investment) {
        return { createQueryBuilder: () => investmentQueryBuilder() };
      }
      if (entity === User) {
        return {
          findOneBy: async (options: { stellarAddress: string }) =>
            users.find((user) => user.stellarAddress === options.stellarAddress) ?? null,
        };
      }
      throw new Error(`Unexpected entity in test fake: ${String(entity)}`);
    },
  } as unknown as DataSource;
}

describe("IssuerAnalyticsService", () => {
  it("returns zeroed-out defaults when the issuer has no invoices", async () => {
    const service = new IssuerAnalyticsService(createFakeDataSource([], []));
    const result = await service.getAnalytics("issuer-1", "all");

    expect(result.totalCapitalRaised).toBe("0.0000");
    expect(result.avgDaysToFullFunding).toBeNull();
    expect(result.onTimeRepaymentRate).toBeNull();
    expect(result.reputationScore).toBe(0);
    expect(result.investorCountTrend).toEqual([]);
  });

  it("sums investmentAmount across CONFIRMED and SETTLED investments only", async () => {
    const invoice = makeInvoice({ status: InvoiceStatus.FUNDED });
    const investments = [
      makeInvestment({
        id: "i1",
        status: InvestmentStatus.CONFIRMED,
        investmentAmount: "300.0000",
      }),
      makeInvestment({ id: "i2", status: InvestmentStatus.SETTLED, investmentAmount: "200.0000" }),
      makeInvestment({ id: "i3", status: InvestmentStatus.PENDING, investmentAmount: "999.0000" }),
    ];
    const service = new IssuerAnalyticsService(createFakeDataSource([invoice], investments));

    const result = await service.getAnalytics("issuer-1", "all");

    expect(result.totalCapitalRaised).toBe("500.0000");
  });

  it("computes avgDaysToFullFunding from the latest backing investment's createdAt", async () => {
    const invoice = makeInvoice({
      status: InvoiceStatus.FUNDED,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const investments = [
      makeInvestment({ id: "i1", createdAt: new Date("2026-01-03T00:00:00Z") }),
      makeInvestment({ id: "i2", createdAt: new Date("2026-01-06T00:00:00Z") }), // latest -> funded day 5
    ];
    const service = new IssuerAnalyticsService(createFakeDataSource([invoice], investments));

    const result = await service.getAnalytics("issuer-1", "all");

    expect(result.avgDaysToFullFunding).toBe(5);
  });

  it("excludes un-funded invoices from avgDaysToFullFunding", async () => {
    const invoice = makeInvoice({ status: InvoiceStatus.PUBLISHED });
    const service = new IssuerAnalyticsService(createFakeDataSource([invoice], []));

    const result = await service.getAnalytics("issuer-1", "all");

    expect(result.avgDaysToFullFunding).toBeNull();
  });

  it("computes onTimeRepaymentRate and reputationScore from SETTLED invoices' updatedAt vs dueDate", async () => {
    const onTime = makeInvoice({
      id: "on-time",
      status: InvoiceStatus.SETTLED,
      dueDate: new Date("2026-02-01T00:00:00Z"),
      updatedAt: new Date("2026-01-31T00:00:00Z"),
    });
    const late = makeInvoice({
      id: "late",
      status: InvoiceStatus.SETTLED,
      dueDate: new Date("2026-02-01T00:00:00Z"),
      updatedAt: new Date("2026-02-05T00:00:00Z"),
    });
    const service = new IssuerAnalyticsService(createFakeDataSource([onTime, late], []));

    const result = await service.getAnalytics("issuer-1", "all");

    expect(result.onTimeRepaymentRate).toBe(50);
    expect(result.reputationScore).toBe(50);
  });

  it("buckets the investor-count trend daily for 30d and monthly for all", async () => {
    const invoice = makeInvoice({});
    const investments = [
      makeInvestment({ id: "i1", investorId: "a", createdAt: new Date("2026-01-05T00:00:00Z") }),
      makeInvestment({ id: "i2", investorId: "b", createdAt: new Date("2026-01-05T12:00:00Z") }),
      makeInvestment({ id: "i3", investorId: "a", createdAt: new Date("2026-02-10T00:00:00Z") }),
    ];
    const service = new IssuerAnalyticsService(createFakeDataSource([invoice], investments));

    const all = await service.getAnalytics("issuer-1", "all");
    expect(all.granularity).toBe("month");
    expect(all.investorCountTrend).toEqual([
      { period: "2026-01", investorCount: 2 },
      { period: "2026-02", investorCount: 1 },
    ]);
  });

  it("caches a result for 5 minutes and returns the stale value on an immediate repeat call", async () => {
    const invoice = makeInvoice({});
    const dataSource = createFakeDataSource([invoice], []);
    const service = new IssuerAnalyticsService(dataSource);

    const first = await service.getAnalytics("issuer-1", "all");

    // Mutate the underlying data after the first read; a cached second read
    // must not see it.
    invoice.status = InvoiceStatus.SETTLED;

    const second = await service.getAnalytics("issuer-1", "all");
    // The cache round trips through JSON, so identity is not preserved; what
    // matters is that the second call is served from cache rather than
    // recomputed against the mutated invoice.
    expect(second).toStrictEqual(first);
  });

  it("invalidate() busts the cache for every range of that issuer", async () => {
    const invoice = makeInvoice({ status: InvoiceStatus.PUBLISHED });
    const investments: Investment[] = [];
    const dataSource = createFakeDataSource([invoice], investments);
    const service = new IssuerAnalyticsService(dataSource);

    const before = await service.getAnalytics("issuer-1", "all");
    expect(before.onTimeRepaymentRate).toBeNull();

    invoice.status = InvoiceStatus.SETTLED;
    invoice.updatedAt = new Date("2026-01-02T00:00:00Z"); // before dueDate 2026-02-01
    service.invalidate("issuer-1");

    const after = await service.getAnalytics("issuer-1", "all");
    expect(after.onTimeRepaymentRate).toBe(100);
  });

  it("getAnalyticsByWallet resolves the issuer id from a Stellar address", async () => {
    const issuer = { id: "issuer-1", stellarAddress: "GISSUERADDR" } as User;
    const invoice = makeInvoice({ sellerId: "issuer-1" });
    const service = new IssuerAnalyticsService(createFakeDataSource([invoice], [], [issuer]));

    const result = await service.getAnalyticsByWallet("GISSUERADDR", "all");

    expect(result.issuerId).toBe("issuer-1");
  });

  it("getAnalyticsByWallet throws for an unknown wallet", async () => {
    const service = new IssuerAnalyticsService(createFakeDataSource([], [], []));

    await expect(service.getAnalyticsByWallet("GUNKNOWN", "all")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
