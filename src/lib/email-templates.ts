export type EmailTemplateName =
  | "settlement"
  | "kyc_status"
  | "invoice_approved"
  | "invoice_rejected"
  | "auto_invest_executed"
  | "referral_reward";

export type EmailDeliveryStatus = "sent" | "delivered" | "bounced" | "opened" | "failed";

export const MAX_BOUNCE_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 60_000;

const TEMPLATES: Record<EmailTemplateName, { subject: string; body: string }> = {
  settlement: {
    subject: "Invoice {{invoiceNumber}} has settled",
    body: "Invoice {{invoiceNumber}} settled for {{amount}}.",
  },
  kyc_status: {
    subject: "Your KYC status is now {{status}}",
    body: "Your identity verification status changed to {{status}}.",
  },
  invoice_approved: {
    subject: "Invoice {{invoiceNumber}} was approved",
    body: "Your invoice {{invoiceNumber}} was approved and is now listed.",
  },
  invoice_rejected: {
    subject: "Invoice {{invoiceNumber}} was rejected",
    body: "Your invoice {{invoiceNumber}} was rejected: {{reason}}.",
  },
  auto_invest_executed: {
    subject: "Auto invest executed",
    body: "Your auto invest rule invested {{amount}} in invoice {{invoiceNumber}}.",
  },
  referral_reward: {
    subject: "You earned a referral reward",
    body: "You earned {{amount}} for referring {{referee}}.",
  },
};

export interface RenderedEmail {
  subject: string;
  body: string;
}

function interpolate(text: string, data: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in data ? String(data[key]) : match
  );
}

/** Renders a template and appends the unsubscribe link every email must carry. */
export function renderEmailTemplate(
  name: EmailTemplateName,
  data: Record<string, string | number>,
  unsubscribeUrl: string
): RenderedEmail {
  const template = TEMPLATES[name];
  return {
    subject: interpolate(template.subject, data),
    body: `${interpolate(template.body, data)}\n\nUnsubscribe: ${unsubscribeUrl}`,
  };
}

/**
 * Delay before retrying a bounced email, doubling each attempt. Returns null
 * once retries are used up, meaning the send should be flagged for manual review.
 */
export function nextBounceRetryDelayMs(attempt: number): number | null {
  if (attempt >= MAX_BOUNCE_RETRIES) return null;
  return BASE_RETRY_DELAY_MS * 2 ** attempt;
}
