import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("invoice_drafts")
@Index("idx_invoice_drafts_seller_id", ["sellerId"])
@Index("idx_invoice_drafts_seller_wallet", ["sellerWallet"])
@Index("idx_invoice_drafts_expires_at", ["expiresAt"])
export class InvoiceDraft {
  @PrimaryColumn({ name: "id", type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "seller_id", type: "varchar", length: 64 })
  sellerId!: string;

  @Column({ name: "seller_wallet", type: "varchar", length: 56 })
  sellerWallet!: string;

  @Column({ name: "draft_data", type: "jsonb" })
  draftData!: Record<string, unknown>;

  @Column({ name: "last_saved_at", type: "timestamptz", default: () => "NOW()" })
  lastSavedAt!: Date;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
