import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { User } from "./User.model";

@Entity("webhook_subscriptions")
export class WebhookSubscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid" })
  @Index("idx_webhook_subscriptions_user_id")
  userId!: string;

  @Column({ type: "varchar", length: 255 })
  url!: string;

  @Column({ type: "varchar", length: 64 })
  secret!: string;

  @Column({ name: "event_types", type: "jsonb" })
  eventTypes!: string[];

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
