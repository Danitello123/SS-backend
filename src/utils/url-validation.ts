import { URL } from "url";

const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "169.254.169.254",
];

const BLOCKED_CIDR = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^::1$/,
  /^fe80:/,
  /^fc00:/,
];

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export function validateWebhookUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UrlValidationError("Invalid URL format");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UrlValidationError("Only HTTP and HTTPS protocols are allowed");
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTS.includes(hostname)) {
    throw new UrlValidationError("Destination host is not allowed");
  }

  if (BLOCKED_CIDR.some((pattern) => pattern.test(hostname))) {
    throw new UrlValidationError("Private IP ranges are not allowed");
  }

  if (url.protocol === "http:" && process.env.NODE_ENV === "production") {
    throw new UrlValidationError("HTTP is not allowed in production; use HTTPS");
  }
}
