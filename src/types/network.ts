import type { Request } from "express";

/** Networks the `X-Stellar-Network` header may select (issue #588). */
export type StellarNetworkName = "mainnet" | "testnet";

export const STELLAR_NETWORK_NAMES: readonly StellarNetworkName[] = ["mainnet", "testnet"];

export interface StellarNetworkEndpoints {
  network: StellarNetworkName;
  horizonUrl: string;
  networkPassphrase: string;
  /** Soroban contract id deployed on this network, if one is configured. */
  contractId: string | null;
}

/** Populated by `createNetworkContextMiddleware` for every downstream handler/service call in the request. */
export interface NetworkAwareRequest extends Request {
  stellarNetwork?: StellarNetworkEndpoints;
}
