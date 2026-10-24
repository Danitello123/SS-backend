import type { NextFunction, Response } from "express";
import { HttpError } from "../utils/http-error";
import {
  STELLAR_NETWORK_NAMES,
  type NetworkAwareRequest,
  type StellarNetworkName,
} from "../types/network";
import type { StellarNetworksConfig } from "../config/stellar-networks";

const HEADER_NAME = "x-stellar-network";
const DEFAULT_NETWORK: StellarNetworkName = "mainnet";

function isStellarNetworkName(value: string): value is StellarNetworkName {
  return (STELLAR_NETWORK_NAMES as readonly string[]).includes(value);
}

/**
 * Reads `X-Stellar-Network` (`mainnet` | `testnet`) and attaches the
 * matching Horizon/contract endpoints to `req.stellarNetwork`, so every
 * downstream handler and service call in this request routes against the
 * same, explicitly selected network (issue #588).
 *
 * Missing header defaults to `mainnet`; an unrecognized value is a 400, not
 * a silent fallback, since routing a mainnet investor's request at testnet
 * (or vice versa) by accident is the exact failure mode this middleware
 * exists to prevent.
 */
export function createNetworkContextMiddleware(networksConfig: StellarNetworksConfig) {
  return (req: NetworkAwareRequest, _res: Response, next: NextFunction): void => {
    const headerValue = req.headers[HEADER_NAME];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const network = raw === undefined ? DEFAULT_NETWORK : raw.trim().toLowerCase();

    if (!isStellarNetworkName(network)) {
      next(
        new HttpError(
          400,
          `Invalid X-Stellar-Network header "${raw}". Expected one of: ${STELLAR_NETWORK_NAMES.join(", ")}.`,
        ),
      );
      return;
    }

    req.stellarNetwork = networksConfig[network];
    next();
  };
}
