import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import Decimal from "decimal.js";
import { Invoice } from "./Invoice.model";

@Entity("secondary_market_price_history")
@Index("idx_price_history_invoice_created", ["invoiceId", "createdAt"])
@Index("idx_price_history_invoice_date_range", ["invoiceId", "createdAt"])
export class SecondaryMarketPriceHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  invoiceId!: string;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: "invoiceId" })
  invoice!: Invoice;

  @Column({ type: "decimal", precision: 18, scale: 8 })
  askPrice!: Decimal;

  @Column({ type: "integer", default: 1 })
  listingCount!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

export interface PriceHistoryPoint {
  timestamp: Date;
  minPrice: Decimal;
  maxPrice: Decimal;
  avgPrice: Decimal;
}
