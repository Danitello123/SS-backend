import { DataSource, EntityManager } from "typeorm";
import { Decimal } from "decimal.js";
import { Invoice } from "../models/Invoice.model";
import { Investment } from "../models/Investment.model";
import { InvoiceStatus, InvestmentStatus } from "../types/enums";
import { ServiceError } from "../utils/service-error";

export interface SettleInvoiceInput {
  invoiceId: string;
  proceeds: string;
}

export interface InvestorSettlement {
  investmentId: string;
  investorId: string;
  investmentAmount: string;
  actualReturn: string;
}

export interface SettleInvoiceResult {
  invoiceId: string;
  status: InvoiceStatus.SETTLED;
  proceeds: string;
  settlements: InvestorSettlement[];
}

export class SettlementService {
  constructor(
    private readonly dataSource: DataSource,
    /** Notified with the invoice's `sellerId` once it settles, so cached issuer analytics can be invalidated (issue #587). */
    private readonly onInvoiceChanged?: (sellerId: string) => void,
  ) {}

  /**
   * Settles a funded invoice by distributing proceeds to each investor
   * pro-rata to their share of the invoice's face value.
   */
  async settleInvoice(input: SettleInvoiceInput): Promise<SettleInvoiceResult> {
    const { invoiceId, proceeds: proceedsInput } = input;

    const proceeds = new Decimal(proceedsInput);
    if (proceeds.isNegative() || proceeds.isZero()) {
      throw new ServiceError(
        "INVALID_PROCEEDS",
        "Settlement proceeds must be greater than zero",
      );
    }

    return await this.dataSource.transaction(async (transactionalEntityManager: EntityManager) => {
      // 1. Lock the invoice row for update
      const invoice = await transactionalEntityManager
        .createQueryBuilder(Invoice, "invoice")
        .setLock("pessimistic_write")
        .where("invoice.id = :id", { id: invoiceId })
        .getOne();

      if (!invoice) {
        throw new ServiceError("INVOICE_NOT_FOUND", "Invoice not found", 404);
      }

      // 2. Validate invoice status
      if (invoice.status !== InvoiceStatus.FUNDED) {
        throw new ServiceError(
          "INVALID_INVOICE_STATUS",
          `Cannot settle an invoice with status ${invoice.status}`,
        );
      }

      // 3. Find confirmed investments backing this invoice
      const investments = await transactionalEntityManager.find(Investment, {
        where: { invoiceId: invoice.id, status: InvestmentStatus.CONFIRMED },
      });

      if (investments.length === 0) {
        throw new ServiceError(
          "NO_CONFIRMED_INVESTMENTS",
          "Invoice has no confirmed investments to settle",
        );
      }

      // 4. Distribute proceeds pro-rata to each investor's share of the face value
      const faceValue = new Decimal(invoice.amount);
      const settlements: InvestorSettlement[] = [];

      for (const investment of investments) {
        const investmentAmount = new Decimal(investment.investmentAmount);
        const actualReturn = investmentAmount
          .times(proceeds)
          .dividedBy(faceValue)
          .toDecimalPlaces(4);

        investment.actualReturn = actualReturn.toFixed(4);
        investment.status = InvestmentStatus.SETTLED;
        await transactionalEntityManager.save(Investment, investment);

        settlements.push({
          investmentId: investment.id,
          investorId: investment.investorId,
          investmentAmount: investment.investmentAmount,
          actualReturn: investment.actualReturn,
        });
      }

      // 5. Transition invoice to SETTLED
      invoice.status = InvoiceStatus.SETTLED;
      await transactionalEntityManager.save(Invoice, invoice);
      this.onInvoiceChanged?.(invoice.sellerId);

      return {
        invoiceId: invoice.id,
        status: InvoiceStatus.SETTLED as const,
        proceeds: proceeds.toFixed(4),
        settlements,
      };
    });
  }
}

export function createSettlementService(
  dataSource: DataSource,
  onInvoiceChanged?: (sellerId: string) => void,
): SettlementService {
  return new SettlementService(dataSource, onInvoiceChanged);
}
