import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("waitlist_entries")
@Index("uq_waitlist_wallet", ["wallet"], { unique: true })
@Index("idx_waitlist_status_created", ["status", "createdAt"])
export class WaitlistEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 56 })
  wallet!: string;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ name: "referral_code", type: "varchar", length: 64, unique: true })
  referralCode!: string;

  @Column({ name: "referral_count", type: "integer", default: 0 })
  referralCount!: number;

  @Column({ type: "varchar", length: 24, default: "pending" })
  status!: "pending" | "approved";

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
