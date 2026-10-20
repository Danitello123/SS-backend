import { DataSource } from "typeorm";
import { TtlCache } from "../lib/ttl-cache";

export interface ContractEntry {
  name: string;
  version: string;
  address: string;
  lastUpgraded: number;
  registeredAt: number;
}

export interface ContractVersionHistory {
  version: string;
  address: string;
  upgradedAt: number;
  upgradedBy: string;
}

export interface ContractDetail extends ContractEntry {
  versionHistory: ContractVersionHistory[];
}

/**
 * #682 — Platform upgrade registry REST API for contract version tracking.
 * Indexes ContractRegistered and ContractUpgraded events.
 */
export class ContractRegistryService {
  private cache: TtlCache;

  constructor(private readonly dataSource: DataSource) {
    this.cache = new TtlCache({ ttlSeconds: 300, namespace: "contract-registry" });
  }

  async getAllContracts(): Promise<ContractEntry[]> {
    const cacheKey = "all";
    const cached = this.cache.get<ContractEntry[]>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT name, version, address, last_upgraded, registered_at
       FROM contract_registry ORDER BY name`,
    );

    const contracts = rows.map((r: any) => this.mapEntry(r));
    this.cache.set(cacheKey, contracts);
    return contracts;
  }

  async getContractDetail(name: string): Promise<ContractDetail | null> {
    const cacheKey = `detail:${name}`;
    const cached = this.cache.get<ContractDetail>(cacheKey);
    if (cached) return cached;

    const rows = await this.dataSource.query(
      `SELECT name, version, address, last_upgraded, registered_at
       FROM contract_registry WHERE name = $1`,
      [name],
    );

    if (!rows.length) return null;

    const historyRows = await this.dataSource.query(
      `SELECT version, address, upgraded_at, upgraded_by
       FROM contract_version_history WHERE contract_name = $1
       ORDER BY upgraded_at DESC`,
      [name],
    );

    const detail: ContractDetail = {
      ...this.mapEntry(rows[0]),
      versionHistory: historyRows.map((r: any) => ({
        version: r.version,
        address: r.address,
        upgradedAt: r.upgraded_at,
        upgradedBy: r.upgraded_by,
      })),
    };

    this.cache.set(cacheKey, detail);
    return detail;
  }

  async checkCompatibility(name: string, minVersion: string): Promise<{ compatible: boolean; currentVersion: string }> {
    const detail = await this.getContractDetail(name);
    if (!detail) return { compatible: false, currentVersion: "" };

    const compatible = this.compareVersions(detail.version, minVersion) >= 0;
    return { compatible, currentVersion: detail.version };
  }

  private mapEntry(r: any): ContractEntry {
    return {
      name: r.name,
      version: r.version,
      address: r.address,
      lastUpgraded: r.last_upgraded,
      registeredAt: r.registered_at,
    };
  }

  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  /** Invalidate cache when a registry event occurs. */
  invalidate(): void {
    this.cache.clearNamespace("contract-registry");
  }
}
