import { Networks } from "stellar-sdk";
import type { StellarNetworkEndpoints, StellarNetworkName } from "../types/network";

/**
 * Per-network Horizon/contract endpoints (issue #588), kept separate from
 * `AppConfig["stellar"]` -- that field is the single network the process
 * started with; this is the full mainnet/testnet table a request can select
 * between via `X-Stellar-Network`.
 */
export interface StellarNetworksConfig {
  mainnet: StellarNetworkEndpoints;
  testnet: StellarNetworkEndpoints;
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function getStellarNetworksConfig(): StellarNetworksConfig {
  return {
    mainnet: {
      network: "mainnet",
      horizonUrl: requireEnv(process.env.MAINNET_HORIZON_URL, "MAINNET_HORIZON_URL"),
      networkPassphrase: Networks.PUBLIC,
      contractId: process.env.MAINNET_CONTRACT_ID ?? null,
    },
    testnet: {
      network: "testnet",
      horizonUrl: requireEnv(process.env.TESTNET_HORIZON_URL, "TESTNET_HORIZON_URL"),
      networkPassphrase: Networks.TESTNET,
      contractId: process.env.TESTNET_CONTRACT_ID ?? null,
    },
  };
}

export function resolveStellarNetworkEndpoints(
  config: StellarNetworksConfig,
  network: StellarNetworkName,
): StellarNetworkEndpoints {
  return config[network];
}
