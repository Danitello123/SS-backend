import type { DataSource } from "typeorm";
import { SettlementWorker } from "../../../src/workers/settlement.worker";
import type { SettlementService } from "../../../src/services/settlement.service";
import { SYSTEM_SETTLEMENT_ACTOR } from "../../../src/services/settlement.service";
import { Invoice } from "../../../src/models/Invoice.model";
import { InvoiceStatus } from "../../../src/types/enums";

function createMaturedInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-628-1",
    sellerId: "seller-628",
    invoiceNumber: "INV-628-001",
    amount: "5000.0000",
    dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: InvoiceStatus.FUNDED,
    sellerWallet: null,
    ...overrides,
  } as Invoice;
}

function createWorker(invoices: Invoice[]) {
  const find = jest.fn(async () => invoices);
  const settleInvoice = jest.fn(async (_input: { actorWallet: string }) => ({
    invoiceId: invoices[0]?.id ?? "none",
    status: InvoiceStatus.SETTLED,
    proceeds: "0.0000",
    totalDistributed: "0.0000",
    remainder: "0.0000",
    remainderDust: "0.0000",
    settlements: [],
  }));

  const worker = new SettlementWorker({
    dataSource: {
      getRepository: () => ({ find }),
    } as unknown as DataSource,
    settlementService: { settleInvoice } as unknown as SettlementService,
  });

  return { worker, settleInvoice };
}

describe("SettlementWorker automated settlement (#628)", () => {
  it("settles matured invoices as the system actor instead of the seller", async () => {
    const invoice = createMaturedInvoice();
    const { worker, settleInvoice } = createWorker([invoice]);

    await worker.processMaturedInvoices();

    expect(settleInvoice).toHaveBeenCalledTimes(1);
    expect(settleInvoice).toHaveBeenCalledWith({
      invoiceId: invoice.id,
      proceeds: invoice.amount,
      actorWallet: SYSTEM_SETTLEMENT_ACTOR,
      systemTrigger: "system_matured",
      sellerId: invoice.sellerId,
    });
  });

  it("does not impersonate a seller wallet even when one is recorded", async () => {
    const invoice = createMaturedInvoice({ sellerWallet: "GSELLERWALLET" });
    const { worker, settleInvoice } = createWorker([invoice]);

    await worker.processMaturedInvoices();

    const [input] = settleInvoice.mock.calls[0] as unknown as [{ actorWallet: string }];
    expect(input.actorWallet).toBe(SYSTEM_SETTLEMENT_ACTOR);
    expect(input.actorWallet).not.toBe(invoice.sellerWallet);
  });

  it("skips invoices that have not reached maturity", async () => {
    const invoice = createMaturedInvoice({
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const { worker, settleInvoice } = createWorker([invoice]);

    await worker.processMaturedInvoices();

    expect(settleInvoice).not.toHaveBeenCalled();
  });
});
