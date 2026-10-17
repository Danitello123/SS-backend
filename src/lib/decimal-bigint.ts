const SCALE = 4;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/**
 * Converts a fixed-4-decimal-place amount string (e.g. "1234.5600") into a
 * scaled bigint (12345600n) suitable for pure integer arithmetic.
 */
export function decimalStringToScaledBigInt(value: string | number): bigint {
  const normalized = String(value).trim();
  const isNegative = normalized.startsWith("-");
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const [wholePart, fractionalPart = ""] = unsigned.split(".");
  const paddedFraction = `${fractionalPart}${"0".repeat(SCALE)}`.slice(0, SCALE);
  const scaled = BigInt(`${wholePart || "0"}${paddedFraction}`);

  return isNegative ? -scaled : scaled;
}

/**
 * Converts a scaled bigint back into a fixed-4-decimal-place amount string.
 */
export function scaledBigIntToDecimalString(value: bigint): string {
  const isNegative = value < 0n;
  const absolute = isNegative ? -value : value;
  const whole = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR).toString().padStart(SCALE, "0");

  return `${isNegative ? "-" : ""}${whole}.${fraction}`;
}
