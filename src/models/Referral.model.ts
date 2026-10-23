import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("referrals")
@Index("uq_referral_referee", ["refereeWallet"], { unique: true })
@Index("idx_referral_referrer", ["referrerWallet", "createdAt"])
export class Referral {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "referrer_wallet", type: "varchar", length: 56 })
  referrerWallet!: string;

  @Column({ name: "referee_wallet", type: "varchar", length: 56 })
  refereeWallet!: string;

  @Column({ name: "earned_amount", type: "decimal", precision: 18, scale: 4, default: 0 })
  earnedAmount!: string;

  @Column({ name: "claimed_amount", type: "decimal", precision: 18, scale: 4, default: 0 })
  claimedAmount!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
