import { Repository } from "typeorm";
import { Invoice } from "../models/Invoice.model";
import { Investment } from "../models/Investment.model";
import { InvoiceStatus } from "../types/enums";
import { ServiceError } from "../utils/service-error";
import { logger } from "../observability/logger";

export class InvoiceRefundService {
  constructor(
    private invoiceRepo: Repository<Invoice>,
    private investmentRepo: Repository<Investment>
  ) {}

  async canRefund(invoiceId: string): Promise<{
    canRefund: boolean;
    reason?: string;
  }> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      return { canRefund: false, reason: "Invoice not found" };
    }

    if (invoice.status === InvoiceStatus.FUNDED) {
      return { canRefund: false, reason: "Cannot refund funded invoice" };
    }

    if (invoice.status === InvoiceStatus.SETTLED) {
      return { canRefund: false, reason: "Cannot refund settled invoice" };
    }

    const now = new Date();
    if (invoice.fundingDeadline && now < invoice.fundingDeadline) {
      return { canRefund: false, reason: "Invoice funding deadline not reached" };
    }

    return { canRefund: true };
  }

  async refundInvestment(
    invoiceId: string,
    walletAddress: string
  ): Promise<void> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      throw new ServiceError("invoice_not_found", "Invoice not found", 404);
    }

    const investment = await this.investmentRepo.findOne({
      where: {
        invoiceId,
        investorWallet: walletAddress,
      },
    });

    if (!investment) {
      throw new ServiceError("investment_not_found", "Investment record not found", 404);
    }

    const { canRefund, reason } = await this.canRefund(invoiceId);
    if (!canRefund) {
      throw new ServiceError("invoice_not_refundable", reason || "Cannot refund invoice", 400);
    }

    logger.info("Processing refund", {
      invoiceId,
      investorWallet: walletAddress,
      amount: investment.investmentAmount,
    });

    await this.investmentRepo.remove(investment);

    const remainingInvestments = await this.investmentRepo.count({
      where: { invoiceId },
    });

    if (remainingInvestments === 0) {
      invoice.status = InvoiceStatus.CANCELLED;
      await this.invoiceRepo.save(invoice);
    }
  }

  async getRefundableInvoices(walletAddress: string): Promise<Invoice[]> {
    const now = new Date();

    return this.invoiceRepo
      .createQueryBuilder("invoice")
      .innerJoin("invoice.investments", "investment")
      .where("investment.investorWallet = :walletAddress", { walletAddress })
      .andWhere("invoice.fundingDeadline < :now", { now })
      .andWhere("invoice.status = :status", { status: InvoiceStatus.PUBLISHED })
      .distinct(true)
      .getMany();
  }
}
