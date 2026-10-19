import { Repository } from "typeorm";
import {
  InvestorAccreditation,
  AccreditationTier,
  ACCREDITATION_LIMITS,
} from "../models/InvestorAccreditation.model";
import { Invoice } from "../models/Invoice.model";
import Decimal from "decimal.js";

export class InvestorAccreditationService {
  constructor(
    private accreditationRepo: Repository<InvestorAccreditation>,
    private invoiceRepo: Repository<Invoice>
  ) {}

  async getAccreditation(walletAddress: string): Promise<InvestorAccreditation> {
    let accreditation = await this.accreditationRepo.findOne({
      where: { walletAddress },
    });

    if (!accreditation) {
      accreditation = this.accreditationRepo.create({
        walletAddress,
        tier: AccreditationTier.UNACCREDITED,
      });
      accreditation = await this.accreditationRepo.save(accreditation);
    }

    return accreditation;
  }

  async updateAccreditation(
    walletAddress: string,
    tier: AccreditationTier,
    verificationSource?: string
  ): Promise<InvestorAccreditation> {
    let accreditation = await this.accreditationRepo.findOne({
      where: { walletAddress },
    });

    if (!accreditation) {
      accreditation = this.accreditationRepo.create({
        walletAddress,
        tier,
        verificationDate: new Date(),
        verificationSource: verificationSource || null,
      });
    } else {
      accreditation.tier = tier;
      accreditation.verificationDate = new Date();
      accreditation.verificationSource = verificationSource || null;
    }

    return this.accreditationRepo.save(accreditation);
  }

  async checkEligibility(
    walletAddress: string,
    invoiceId: string
  ): Promise<{ eligible: boolean; reason?: string }> {
    const accreditation = await this.getAccreditation(walletAddress);
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });

    if (!invoice) {
      return { eligible: false, reason: "Invoice not found" };
    }

    const investmentLimit = ACCREDITATION_LIMITS[accreditation.tier];
    const invoiceAmount = new Decimal(invoice.amount);

    if (invoiceAmount.greaterThan(investmentLimit)) {
      return {
        eligible: false,
        reason: `Investment exceeds ${accreditation.tier} tier limit of $${investmentLimit}`,
      };
    }

    return { eligible: true };
  }

  getInvestmentLimit(tier: AccreditationTier): number {
    return ACCREDITATION_LIMITS[tier];
  }
}
