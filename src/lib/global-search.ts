const STELLAR_TX_HASH = /^[0-9a-f]{64}$/i;

export interface GroupedSearchResults<I, S, T> {
  invoices: I[];
  issuers: S[];
  transactions: T[];
}

export function isStellarTxHash(query: string): boolean {
  return STELLAR_TX_HASH.test(query.trim());
}

/** Trims each category to the limits shown in the search overlay. */
export function groupSearchResults<I, S, T>(
  invoices: I[],
  issuers: S[],
  transactions: T[]
): GroupedSearchResults<I, S, T> {
  return {
    invoices: invoices.slice(0, 3),
    issuers: issuers.slice(0, 3),
    transactions: transactions.slice(0, 1),
  };
}
