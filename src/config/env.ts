import { config } from "dotenv";
import "dotenv/config";
import { Networks } from "stellar-sdk";
import path from "path";
import os from "os";

config();

type SupportedStellarNetwork = "testnet" | "mainnet" | "futurenet";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  auth: {
    challengeTtlMs: number;
  };
  observability: {
    metricsEnabled: boolean;
  };
  http: {
    trustProxy: boolean | number | string;
    corsAllowedOrigins: string[];
    corsAllowCredentials: boolean;
    bodySizeLimit: string;
    shutdownTimeoutMs: number;
    rateLimit?: {
      enabled: boolean;
      windowMs: number;
      max: number;
    };
  };
  reconciliation: {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
    gracePeriodMs: number;
    maxRuntimeMs: number;
  };
  stellar: {
    network: SupportedStellarNetwork;
    networkPassphrase: string;
  };
  sorobanEscrow: {
    enabled: boolean;
    contractId: string | null;
    fundingMode: "wallet_xdr";
  };
  ipfs: {
    apiUrl: string;
    jwt: string;
    gatewayUrl: string;
    maxFileSizeMB: number;
    allowedMimeTypes: string[];
    uploadRateLimit: {
      windowMs: number;
      maxUploads: number;
    };
  };
  documentExport: {
    /** Signs/verifies the download token in a bulk-export's signed URL (issue #589). */
    signingSecret: string;
    /** How long a signed download URL (and the ZIP it points to) stays valid. */
    urlTtlMinutes: number;
    /** Where generated ZIPs are written before being streamed and cleaned up. */
    tempDir: string;
  };
  kyc: {
    skipVerification: boolean;
  };
}


// ---------------- DEFAULTS ----------------

const DEFAULT_PORT = 3000;
const DEFAULT_JWT_EXPIRES_IN = "15m";
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_METRICS_ENABLED = true;

const DEFAULT_RECONCILIATION_ENABLED = false;
const DEFAULT_RECONCILIATION_INTERVAL_MS = 30 * 1000;
const DEFAULT_RECONCILIATION_BATCH_SIZE = 25;
const DEFAULT_RECONCILIATION_GRACE_PERIOD_MS = 60 * 1000;
const DEFAULT_RECONCILIATION_MAX_RUNTIME_MS = 10 * 1000;

const DEFAULT_BODY_SIZE_LIMIT = "1mb";
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15 * 1000;

const DEFAULT_IPFS_MAX_FILE_SIZE_MB = 10;
const DEFAULT_IPFS_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const DEFAULT_IPFS_UPLOAD_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_IPFS_UPLOAD_RATE_LIMIT_MAX_UPLOADS = 10;
const DEFAULT_IPFS_GATEWAY_URL = "https://gateway.pinata.cloud/ipfs";

const DEFAULT_DOCUMENT_EXPORT_URL_TTL_MINUTES = 60;


// ---------------- HELPERS ----------------

function parsePort(value?: string): number {
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (!value) return fallback;

  const v = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;

  throw new Error(`${name} must be a boolean.`);
}

function parseCsv(value?: string): string[] {
  if (!value) return [];
  return value.split(",").map(v => v.trim()).filter(Boolean);
}

function parseTrustProxy(value?: string): boolean | number | string {
  if (!value) return false;

  const v = value.toLowerCase();

  if (["true", "1"].includes(v)) return true;
  if (["false", "0"].includes(v)) return false;

  const num = Number(value);
  if (!isNaN(num)) return num;

  return value;
}

function resolveNetwork(network?: string): AppConfig["stellar"] {
  switch ((network ?? "testnet").toLowerCase()) {
    case "testnet":
      return { network: "testnet", networkPassphrase: Networks.TESTNET };
    case "mainnet":
    case "public":
      return { network: "mainnet", networkPassphrase: Networks.PUBLIC };
    case "futurenet":
      return { network: "futurenet", networkPassphrase: Networks.FUTURENET };
    default:
      throw new Error("Invalid STELLAR_NETWORK");
  }
}

function requireString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}


// ---------------- MAIN CONFIG ----------------

export function getConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    nodeEnv: process.env.NODE_ENV ?? "development",

    jwt: {
      secret: requireString(process.env.JWT_SECRET, "JWT_SECRET"),
      expiresIn: process.env.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES_IN,
    },

    auth: {
      challengeTtlMs: parsePositiveInteger(
        process.env.AUTH_CHALLENGE_TTL_MS,
        DEFAULT_CHALLENGE_TTL_MS,
        "AUTH_CHALLENGE_TTL_MS"
      ),
    },

    observability: {
      metricsEnabled: parseBoolean(
        process.env.METRICS_ENABLED,
        DEFAULT_METRICS_ENABLED,
        "METRICS_ENABLED"
      ),
    },

    http: {
      trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
      corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS),
      corsAllowCredentials: parseBoolean(
        process.env.CORS_ALLOW_CREDENTIALS,
        true,
        "CORS_ALLOW_CREDENTIALS"
      ),
      bodySizeLimit: process.env.HTTP_BODY_SIZE_LIMIT ?? DEFAULT_BODY_SIZE_LIMIT,
      shutdownTimeoutMs: parsePositiveInteger(
        process.env.HTTP_SHUTDOWN_TIMEOUT_MS,
        DEFAULT_SHUTDOWN_TIMEOUT_MS,
        "HTTP_SHUTDOWN_TIMEOUT_MS"
      ),
      rateLimit: {
        enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true, "RATE_LIMIT_ENABLED"),
        windowMs: parsePositiveInteger(
          process.env.RATE_LIMIT_WINDOW_MS,
          60000,
          "RATE_LIMIT_WINDOW_MS"
        ),
        max: parsePositiveInteger(
          process.env.RATE_LIMIT_MAX,
          100,
          "RATE_LIMIT_MAX"
        ),
      },
    },

    reconciliation: {
      enabled: parseBoolean(
        process.env.STELLAR_RECONCILIATION_ENABLED,
        DEFAULT_RECONCILIATION_ENABLED,
        "STELLAR_RECONCILIATION_ENABLED"
      ),
      intervalMs: parsePositiveInteger(
        process.env.STELLAR_RECONCILIATION_INTERVAL_MS,
        DEFAULT_RECONCILIATION_INTERVAL_MS,
        "STELLAR_RECONCILIATION_INTERVAL_MS"
      ),
      batchSize: parsePositiveInteger(
        process.env.STELLAR_RECONCILIATION_BATCH_SIZE,
        DEFAULT_RECONCILIATION_BATCH_SIZE,
        "STELLAR_RECONCILIATION_BATCH_SIZE"
      ),
      gracePeriodMs: parsePositiveInteger(
        process.env.STELLAR_RECONCILIATION_GRACE_PERIOD_MS,
        DEFAULT_RECONCILIATION_GRACE_PERIOD_MS,
        "STELLAR_RECONCILIATION_GRACE_PERIOD_MS"
      ),
      maxRuntimeMs: parsePositiveInteger(
        process.env.STELLAR_RECONCILIATION_MAX_RUNTIME_MS,
        DEFAULT_RECONCILIATION_MAX_RUNTIME_MS,
        "STELLAR_RECONCILIATION_MAX_RUNTIME_MS"
      ),
    },

    stellar: resolveNetwork(process.env.STELLAR_NETWORK),

    sorobanEscrow: {
      enabled: parseBoolean(process.env.SOROBAN_ESCROW_ENABLED, false, "SOROBAN_ESCROW_ENABLED"),
      contractId: process.env.SOROBAN_ESCROW_CONTRACT_ID ?? null,
      fundingMode: "wallet_xdr",
    },

    ipfs: {
      apiUrl: requireString(process.env.IPFS_API_URL, "IPFS_API_URL"),
      jwt: requireString(process.env.IPFS_JWT, "IPFS_JWT"),
      gatewayUrl: process.env.IPFS_GATEWAY_URL ?? DEFAULT_IPFS_GATEWAY_URL,
      maxFileSizeMB: parsePositiveInteger(
        process.env.IPFS_MAX_FILE_SIZE_MB,
        DEFAULT_IPFS_MAX_FILE_SIZE_MB,
        "IPFS_MAX_FILE_SIZE_MB"
      ),
      allowedMimeTypes:
        parseCsv(process.env.IPFS_ALLOWED_MIME_TYPES).length > 0
          ? parseCsv(process.env.IPFS_ALLOWED_MIME_TYPES)
          : DEFAULT_IPFS_ALLOWED_MIME_TYPES,
      uploadRateLimit: {
        windowMs: parsePositiveInteger(
          process.env.IPFS_UPLOAD_RATE_LIMIT_WINDOW_MS,
          DEFAULT_IPFS_UPLOAD_RATE_LIMIT_WINDOW_MS,
          "IPFS_UPLOAD_RATE_LIMIT_WINDOW_MS"
        ),
        maxUploads: parsePositiveInteger(
          process.env.IPFS_UPLOAD_RATE_LIMIT_MAX_UPLOADS,
          DEFAULT_IPFS_UPLOAD_RATE_LIMIT_MAX_UPLOADS,
          "IPFS_UPLOAD_RATE_LIMIT_MAX_UPLOADS"
        ),
      },
    },

    documentExport: {
      signingSecret: process.env.DOCUMENT_EXPORT_SIGNING_SECRET ?? requireString(process.env.JWT_SECRET, "JWT_SECRET"),
      urlTtlMinutes: parsePositiveInteger(
        process.env.DOCUMENT_EXPORT_URL_TTL_MINUTES,
        DEFAULT_DOCUMENT_EXPORT_URL_TTL_MINUTES,
        "DOCUMENT_EXPORT_URL_TTL_MINUTES"
      ),
      tempDir: process.env.DOCUMENT_EXPORT_TEMP_DIR ?? path.join(os.tmpdir(), "invoice-exports"),
    },

    kyc: {
      skipVerification: parseBoolean(
        process.env.SKIP_KYC_VERIFICATION,
        process.env.NODE_ENV !== "production",
        "SKIP_KYC_VERIFICATION"
      ),
    },
  };
}
