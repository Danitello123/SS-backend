/**
 * Shared enums for entity status and type fields.
 */

export enum UserType {
  SELLER = "seller",
  INVESTOR = "investor",
  BOTH = "both",
}

export enum KYCStatus {
  PENDING = "pending",
  IN_REVIEW = "in_review",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export enum InvoiceStatus {
  DRAFT = "draft",
  PENDING = "pending",
  PUBLISHED = "published",
  FUNDED = "funded",
  SETTLED = "settled",
  CANCELLED = "cancelled",
}

export enum InvestmentStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  SETTLED = "settled",
  CANCELLED = "cancelled",
}

export enum TransactionType {
  INVESTMENT = "investment",
  PAYMENT = "payment",
  WITHDRAWAL = "withdrawal",
  REFUND = "refund",
}

export enum TransactionStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum KYCVerificationType {
  IDENTITY = "identity",
  ADDRESS = "address",
  BUSINESS = "business",
}

export enum NotificationType {
  INVOICE = "invoice",
  INVESTMENT = "investment",
  PAYMENT = "payment",
  KYC = "kyc",
  SYSTEM = "system",
}

/** Risk band an auto-invest rule can require (issue #596), derived from `Invoice.riskScore` (0-100, lower is safer). `null` on the rule matches any tier. */
export enum RiskTier {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
}

export enum AutoInvestExecutionStatus {
  EXECUTED = "executed",
  SKIPPED_INSUFFICIENT_BALANCE = "skipped_insufficient_balance",
  FAILED = "failed",
}
