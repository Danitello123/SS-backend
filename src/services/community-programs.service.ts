import { DataSource } from "typeorm";
import Decimal from "decimal.js";
import { InvoiceFraudReport, FraudReportStatus } from "../models/InvoiceFraudReport.model";
import { Referral } from "../models/Referral.model";
import { WaitlistEntry } from "../models/WaitlistEntry.model";

export class CommunityProgramsService {
  constructor(private readonly dataSource: DataSource) {}

  async createFraudReport(input: { invoiceId: string; wallet: string; reason: string; detail: string }) {
    if (!input.reason || input.reason.length > 64 || !input.detail || input.detail.length > 4000) {
      throw Object.assign(new Error("reason and detail are required and must be within the allowed length"), { statusCode: 400 });
    }
    const repository = this.dataSource.getRepository(InvoiceFraudReport);
    const existing = await repository.findOne({ where: { invoiceId: input.invoiceId, reporterWallet: input.wallet } });
    if (existing) throw Object.assign(new Error("A report already exists for this wallet and invoice"), { statusCode: 409 });
    return repository.save(repository.create({ ...input, reporterWallet: input.wallet, status: FraudReportStatus.OPEN, reviewNote: null }));
  }

  listFraudReports(page: number, pageSize: number) {
    return this.dataSource.getRepository(InvoiceFraudReport).findAndCount({
      order: { createdAt: "DESC" }, skip: (page - 1) * pageSize, take: pageSize,
    });
  }

  async reviewFraudReport(id: string, status: FraudReportStatus, reviewNote?: string) {
    if (![FraudReportStatus.INVESTIGATING, FraudReportStatus.RESOLVED, FraudReportStatus.DISMISSED].includes(status)) {
      throw Object.assign(new Error("Invalid report status"), { statusCode: 400 });
    }
    const repository = this.dataSource.getRepository(InvoiceFraudReport);
    const report = await repository.findOneBy({ id });
    if (!report) throw Object.assign(new Error("Fraud report not found"), { statusCode: 404 });
    report.status = status;
    report.reviewNote = reviewNote?.trim().slice(0, 4000) ?? null;
    return repository.save(report);
  }

  async registerReferral(referrerWallet: string, refereeWallet: string) {
    if (!referrerWallet || !refereeWallet || referrerWallet === refereeWallet) {
      throw Object.assign(new Error("A referral must link two different wallets"), { statusCode: 400 });
    }
    const repository = this.dataSource.getRepository(Referral);
    const existing = await repository.findOne({ where: { refereeWallet } });
    if (existing) return existing;
    return repository.save(repository.create({ referrerWallet, refereeWallet, earnedAmount: "0", claimedAmount: "0" }));
  }

  async referralStats(wallet: string) {
    const referrals = await this.dataSource.getRepository(Referral).find({ where: { referrerWallet: wallet }, order: { createdAt: "DESC" } });
    const earned = referrals.reduce((sum, row) => sum.plus(row.earnedAmount), new Decimal(0));
    const claimed = referrals.reduce((sum, row) => sum.plus(row.claimedAmount), new Decimal(0));
    return { totalReferees: referrals.length, earned: earned.toFixed(4), pending: earned.minus(claimed).toFixed(4), history: referrals };
  }

  async buildReferralClaim(wallet: string) {
    const stats = await this.referralStats(wallet);
    if (new Decimal(stats.pending).lte(0)) {
      throw Object.assign(new Error("No referral rewards are available to claim"), { statusCode: 409 });
    }
    return {
      wallet,
      amount: stats.pending,
      // The signing key stays with the wallet client; the API only returns a
      // deterministic claim intent for the configured reward contract.
      unsignedTransaction: { type: "referral_reward_claim", wallet, amount: stats.pending },
    };
  }

  async registerWaitlist(wallet: string, email: string, referralCode?: string) {
    if (!wallet || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error("A valid wallet and email are required"), { statusCode: 400 });
    }
    const repository = this.dataSource.getRepository(WaitlistEntry);
    const existing = await repository.findOne({ where: { wallet } });
    if (existing) return this.waitlistView(existing);
    const entry = await repository.save(repository.create({ wallet, email, referralCode: `${wallet.slice(0, 8)}-${Date.now()}`, referralCount: 0, status: "pending" }));
    if (referralCode) await repository.increment({ referralCode }, "referralCount", 1);
    return this.waitlistView(entry);
  }

  async waitlistView(entry: WaitlistEntry) {
    const ahead = await this.dataSource.getRepository(WaitlistEntry).count({ where: { status: "pending" } });
    return { wallet: entry.wallet, position: Math.max(1, ahead - entry.referralCount), referralCount: entry.referralCount, referralCode: entry.referralCode, status: entry.status };
  }

  async approveWaitlist(wallet: string) {
    const repository = this.dataSource.getRepository(WaitlistEntry);
    const entry = await repository.findOne({ where: { wallet } });
    if (!entry) throw Object.assign(new Error("Waitlist entry not found"), { statusCode: 404 });
    entry.status = "approved";
    return repository.save(entry);
  }
}
