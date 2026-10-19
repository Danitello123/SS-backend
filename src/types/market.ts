/**
 * Types and interfaces for Secondary Market Order Book, FX Rates,
 * Investor Scoring, and Issuer Announcements (Issues #660, #661, #663, #664).
 */

// ==========================================
// Issue #664: Order Book Depth
// ==========================================
export interface OrderBookPriceLevel {
  price: string;
  cumulative_amount: string;
  order_count: number;
}

export interface OrderBookDepthResponse {
  invoice_id: string;
  bids: OrderBookPriceLevel[];
  asks: OrderBookPriceLevel[];
  timestamp: string;
}

// ==========================================
// Issue #663: FX Rates & Currency Conversion
// ==========================================
export interface FxRateRecord {
  pair: string;
  rate: string;
  updated_at: string;
  age_seconds?: number;
  stale?: boolean;
}

export interface AllFxRatesResponse {
  rates: FxRateRecord[];
  timestamp: string;
}

// ==========================================
// Issue #660: Investor Scoring & Tiers
// ==========================================
export type InvestorTierName = "bronze" | "silver" | "gold" | "platinum";

export interface InvestorScoreRecord {
  wallet: string;
  score: number;
  tier: InvestorTierName;
  last_updated: string;
}

export interface InvestorScoreHistoryItem {
  id: string;
  wallet: string;
  event_type: string;
  delta: number;
  score_after: number;
  created_at: string;
}

export interface PaginatedScoreHistoryResponse {
  wallet: string;
  history: InvestorScoreHistoryItem[];
  next_cursor?: string | null;
}

// ==========================================
// Issue #661: Issuer Announcements & IPFS Feed
// ==========================================
export interface AnnouncementSummary {
  id: string;
  invoice_id: string;
  title: string;
  category: string;
  content_hash: string;
  date: string;
}

export interface PaginatedAnnouncementsResponse {
  invoice_id: string;
  announcements: AnnouncementSummary[];
  next_cursor?: string | null;
}

export interface AnnouncementContentResponse {
  id: string;
  content_hash: string;
  content: string;
  retrieved_from_cache: boolean;
}
