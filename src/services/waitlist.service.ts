import { DataSource, Repository } from "typeorm";
import { WaitlistEntry } from "../models/WaitlistEntry.model";
import { logger, type AppLogger } from "../observability/logger";

export interface WaitlistQueryResult {
  entries: WaitlistEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class WaitlistService {
  private repository: Repository<WaitlistEntry>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly appLogger: AppLogger = logger
  ) {
    this.repository = dataSource.getRepository(WaitlistEntry);
  }

  async getWaitlistQueue(
    page: number = 1,
    pageSize: number = 50,
    status: "pending" | "approved" | "all" = "pending"
  ): Promise<WaitlistQueryResult> {
    const skip = (page - 1) * pageSize;

    const query = this.repository
      .createQueryBuilder("w")
      .orderBy("w.createdAt", "ASC");

    if (status !== "all") {
      query.where("w.status = :status", { status });
    }

    const [entries, total] = await query
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    return {
      entries,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async approveSingleWallet(wallet: string): Promise<WaitlistEntry> {
    const entry = await this.repository.findOne({ where: { wallet } });
    if (!entry) {
      throw new Error(`Waitlist entry not found for wallet: ${wallet}`);
    }

    if (entry.status === "approved") {
      this.appLogger.info("waitlist.wallet.already_approved", { wallet });
      return entry;
    }

    entry.status = "approved";
    await this.repository.save(entry);

    this.appLogger.info("waitlist.wallet.approved", {
      wallet,
      referral_count: entry.referralCount,
    });

    return entry;
  }

  async bulkApproveTop(count: number): Promise<WaitlistEntry[]> {
    const entries = await this.repository.find({
      where: { status: "pending" },
      order: { createdAt: "ASC" },
      take: count,
    });

    if (entries.length === 0) {
      this.appLogger.info("waitlist.bulk_approve.no_pending", { requested: count });
      return [];
    }

    const toApprove = entries.map((e) => {
      e.status = "approved";
      return e;
    });

    const approved = await this.repository.save(toApprove);

    this.appLogger.info("waitlist.bulk_approve.success", {
      approved_count: approved.length,
      requested_count: count,
    });

    return approved;
  }

  async getWalletEntry(wallet: string): Promise<WaitlistEntry | null> {
    return this.repository.findOne({ where: { wallet } });
  }

  async getApprovedWallets(): Promise<string[]> {
    const entries = await this.repository.find({
      where: { status: "approved" },
      select: ["wallet"],
    });
    return entries.map((e) => e.wallet);
  }
}

export function createWaitlistService(
  dataSource: DataSource,
  appLogger?: AppLogger
): WaitlistService {
  return new WaitlistService(dataSource, appLogger);
}
