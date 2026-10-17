import { KYCStatus } from "@/types/enums";

export class KYCError extends Error {
  status: number;
  statusCode: number;
  code: string;

  constructor(message: string, code = "KYC_NOT_APPROVED", status = 403) {
    super(message);
    this.name = "KYCError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

export function requireApprovedKYC(user: { kycStatus: KYCStatus }) {
  if (user.kycStatus !== KYCStatus.APPROVED) {
    throw new KYCError("KYC not approved");
  }
}

/** Truncates a wallet address to its first 4 and last 4 characters for safe logging. */
export function truncateWalletAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
