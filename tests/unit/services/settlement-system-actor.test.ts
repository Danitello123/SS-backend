import crypto from "crypto";
import { DataSource } from "typeorm";
import {
  SettlementService,
  SYSTEM_SETTLEMENT_ACTOR,
  isSystemSettlementActor,
} from "../../../src/services/settlement.service";
import { Invoice } from "../../../src/models/Invoice.model";
import { Investment } from "../../../src/models/Investment.model";
import { InvestorReturn } from "../../../src/models/InvestorReturn.model";
import { SettlementRemainder } from "../../../src/models/SettlementRemainder.model";
import { User } from "../../../src/models/User.model";
import { InvoiceStatus, InvestmentStatus } from "../../../src/types/enums";

const SELLER_WALLET = "GSELLER" + "A".repeat(49);

function createInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: crypto.randomUUID(),
    sellerId: crypto.randomUUID(),
    invoiceNumber: "INV-SYSTEM-628",
    customerName: "Buyer Corp",
    amount: "1000.0000",
    discountRate: "0.00",
    netAmount: "1000.0000",
    fundedAmount: "1000.0000",
    settlementRemainder: "0.0000",
    dueDate: new Date(Date.now() - 60_000),
    ipfsHash: null,
    riskScore: null,
    status: InvoiceStatus.FUNDED,
    smartContractId: null,
    rejectionReason: null,
    sellerWallet: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    seller: undefined as unknown as Invoice["seller"],
    investments: [],
    transactions: [],
    investorReturns: [],
    settlementRemainders: [],
    ...overrides,
  } as Invoice;
}

function createInvestment(invoiceId: string): Investment {
  return {
    id: crypto.randomUUID(),
    invoiceId,
    investorId: crypto.randomUUID(),
    investmentAmount: "1000.0000",
    expectedReturn: "1100.0000",
    actualReturn: null,
    status: InvestmentStatus.CONFIRMED,
    investorWallet: "GINVESTOR" + "B".repeat(46),
    fundingBlock: "12345",
    transactionHash: "hash628",
    stellarOperationIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    version: 1,
    investor: { stellarAddress: "GINVESTOR" + "B".repeat(46) } as Investment["investor"],
  } as Investment;
}

/**
 * Fake DataSource that mirrors the shape `settleInvoice` relies on. The seller
 * lookup is the part under test: it returns a seller with a stellar address so
 * the wallet equality guard is actually reachable.
 */
function createFakeDataSource(invoice: Invoice, seller: Partial<User> | null) {
  const invoices = new Map<string, Invoice>([[invoice.id, invoice]]);
  const investments = new Map<string, Investment>(
    [createInvestment(invoice.id)].map((investment) => [investment.id, investment])
  );

  const manager = {
    createQueryBuilder: () => {
      let targetId: string | undefined;
      const builder = {
        setLock: () => builder,
        where: (_clause: string, params: { id: string }) => {
          targetId = params.id;
          return builder;
        },
        getOne: async () => (targetId ? (invoices.get(targetId) ?? null) : null),
      };
      return builder;
    },
    find: async (entity: unknown) => (entity === Investment ? [...investments.values()] : []),
    findOne: async (entity: unknown) => {
      if (entity === User) return seller;
      return null;
    },
    create: (_entity: unknown, data: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      ...data,
    }),
    save: async (entity: unknown, data: unknown) => {
      const record = data as { id: string };
      if (entity === Invoice) invoices.set(record.id, data as Invoice);
      if (entity === Investment) investments.set(record.id, data as Investment);
      return data;
    },
  };

  const dataSource = {
    transaction: async (callback: (m: typeof manager) => Promise<unknown>) => callback(manager),
    getRepository: () => ({ findOne: async () => null }),
  } as unknown as DataSource;

  return { dataSource };
}

describe("SettlementService system actor authorization (#628)", () => {
  it("settles without impersonating the seller when the actor is the system identity", async () => {
    const invoice = createInvoice();
    const { dataSource } = createFakeDataSource(invoice, {
      id: invoice.sellerId,
      stellarAddress: SELLER_WALLET,
    });
    const service = new SettlementService(dataSource);

    const result = await service.settleInvoice({
      invoiceId: invoice.id,
      proceeds: "1100.0000",
      actorWallet: SYSTEM_SETTLEMENT_ACTOR,
      sellerId: invoice.sellerId,
    });

    expect(result.status).toBe(InvoiceStatus.SETTLED);
    expect(result.settlements).toHaveLength(1);
  });

  it("settles for a namespaced system job actor", async () => {
    const invoice = createInvoice();
    const { dataSource } = createFakeDataSource(invoice, {
      id: invoice.sellerId,
      stellarAddress: SELLER_WALLET,
    });
    const service = new SettlementService(dataSource);

    await expect(
      service.settleInvoice({
        invoiceId: invoice.id,
        proceeds: "1100.0000",
        actorWallet: "system:invoice-maturity-job",
        trigger: "maturity_settled",
      })
    ).resolves.toMatchObject({ status: InvoiceStatus.SETTLED });
  });

  it("settles when the caller marks the settlement as system triggered", async () => {
    const invoice = createInvoice();
    const { dataSource } = createFakeDataSource(invoice, {
      id: invoice.sellerId,
      stellarAddress: SELLER_WALLET,
    });
    const service = new SettlementService(dataSource);

    await expect(
      service.settleInvoice({
        invoiceId: invoice.id,
        proceeds: "1100.0000",
        actorWallet: "",
        systemTrigger: "system_matured",
        sellerId: invoice.sellerId,
      })
    ).resolves.toMatchObject({ status: InvoiceStatus.SETTLED });
  });

  it("still rejects a wallet actor that is not the seller", async () => {
    const invoice = createInvoice();
    const { dataSource } = createFakeDataSource(invoice, {
      id: invoice.sellerId,
      stellarAddress: SELLER_WALLET,
    });
    const service = new SettlementService(dataSource);

    await expect(
      service.settleInvoice({
        invoiceId: invoice.id,
        proceeds: "1100.0000",
        actorWallet: "GSOMEONEELSE" + "C".repeat(46),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("still enforces the explicit sellerId check for system actors", async () => {
    const invoice = createInvoice();
    const { dataSource } = createFakeDataSource(invoice, {
      id: invoice.sellerId,
      stellarAddress: SELLER_WALLET,
    });
    const service = new SettlementService(dataSource);

    await expect(
      service.settleInvoice({
        invoiceId: invoice.id,
        proceeds: "1100.0000",
        actorWallet: SYSTEM_SETTLEMENT_ACTOR,
        sellerId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });
});

describe("isSystemSettlementActor (#628)", () => {
  it.each(["system", "system:invoice-maturity-job", "system:settlement-worker"])(
    "recognizes %s as a system actor",
    (actor) => {
      expect(isSystemSettlementActor(actor)).toBe(true);
    }
  );

  it.each(["", null, undefined, "GSYSTEM", "systemic", "gsystem"])(
    "does not treat %p as a system actor",
    (actor) => {
      expect(isSystemSettlementActor(actor)).toBe(false);
    }
  );
});
