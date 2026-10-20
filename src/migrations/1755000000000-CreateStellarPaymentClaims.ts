import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateStellarPaymentClaims1755000000000 implements MigrationInterface {
  name = "CreateStellarPaymentClaims1755000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stellar_payment_claims" (
        "stellar_tx_hash" varchar(64) NOT NULL,
        "stellar_operation_index" integer NOT NULL,
        "investment_id" uuid,
        "transaction_id" uuid,
        CONSTRAINT "uq_stellar_payment_claims_hash_operation"
          PRIMARY KEY ("stellar_tx_hash", "stellar_operation_index")
      );
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          WITH payment_owners AS (
            SELECT
              upper("transaction_hash") AS tx_hash,
              "stellar_operation_index" AS operation_index,
              'investment:' || "id"::text AS owner
            FROM "investments"
            WHERE "transaction_hash" IS NOT NULL
              AND "stellar_operation_index" IS NOT NULL
            UNION ALL
            SELECT
              upper("stellar_tx_hash"),
              "stellar_operation_index",
              CASE
                WHEN "investment_id" IS NULL THEN 'transaction:' || "id"::text
                ELSE 'investment:' || "investment_id"::text
              END
            FROM "transactions"
            WHERE "stellar_tx_hash" IS NOT NULL
              AND "stellar_operation_index" IS NOT NULL
          )
          SELECT 1
          FROM payment_owners
          GROUP BY tx_hash, operation_index
          HAVING count(DISTINCT owner) > 1
        ) THEN
          RAISE EXCEPTION
            'Existing Stellar transaction operations are linked to multiple owners; resolve duplicates before applying this migration.';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      WITH payment_owners AS (
        SELECT
          upper("transaction_hash") AS tx_hash,
          "stellar_operation_index" AS operation_index,
          "id" AS investment_id,
          NULL::uuid AS transaction_id,
          'investment:' || "id"::text AS owner
        FROM "investments"
        WHERE "transaction_hash" IS NOT NULL
          AND "stellar_operation_index" IS NOT NULL
        UNION ALL
        SELECT
          upper("stellar_tx_hash"),
          "stellar_operation_index",
          "investment_id",
          CASE WHEN "investment_id" IS NULL THEN "id" ELSE NULL::uuid END,
          CASE
            WHEN "investment_id" IS NULL THEN 'transaction:' || "id"::text
            ELSE 'investment:' || "investment_id"::text
          END
        FROM "transactions"
        WHERE "stellar_tx_hash" IS NOT NULL
          AND "stellar_operation_index" IS NOT NULL
      ),
      unique_owners AS (
        SELECT DISTINCT ON (tx_hash, operation_index)
          tx_hash, operation_index, investment_id, transaction_id
        FROM payment_owners
        ORDER BY tx_hash, operation_index, owner
      )
      INSERT INTO "stellar_payment_claims" (
        "stellar_tx_hash", "stellar_operation_index", "investment_id", "transaction_id"
      )
      SELECT tx_hash, operation_index, investment_id, transaction_id
      FROM unique_owners;
    `);

    await queryRunner.query(`
      CREATE FUNCTION "claim_stellar_payment_operation"(
        payment_hash varchar,
        operation_index integer,
        payment_investment_id uuid,
        payment_transaction_id uuid
      ) RETURNS void AS $$
      BEGIN
        IF payment_hash IS NULL OR operation_index IS NULL THEN
          RETURN;
        END IF;

        INSERT INTO "stellar_payment_claims" (
          "stellar_tx_hash", "stellar_operation_index", "investment_id", "transaction_id"
        )
        VALUES (
          upper(payment_hash),
          operation_index,
          payment_investment_id,
          payment_transaction_id
        )
        ON CONFLICT ("stellar_tx_hash", "stellar_operation_index")
        DO UPDATE SET
          "investment_id" = EXCLUDED."investment_id",
          "transaction_id" = EXCLUDED."transaction_id"
        WHERE
          "stellar_payment_claims"."investment_id" IS NOT DISTINCT FROM EXCLUDED."investment_id"
          AND "stellar_payment_claims"."transaction_id" IS NOT DISTINCT FROM EXCLUDED."transaction_id";

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stellar payment operation is already claimed'
            USING ERRCODE = '23505',
              CONSTRAINT = 'uq_stellar_payment_claims_hash_operation';
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE FUNCTION "claim_stellar_investment_payment"() RETURNS trigger AS $$
      BEGIN
        PERFORM "claim_stellar_payment_operation"(
          NEW."transaction_hash",
          NEW."stellar_operation_index",
          NEW."id",
          NULL
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE FUNCTION "claim_stellar_transaction_payment"() RETURNS trigger AS $$
      BEGIN
        PERFORM "claim_stellar_payment_operation"(
          NEW."stellar_tx_hash",
          NEW."stellar_operation_index",
          NEW."investment_id",
          CASE WHEN NEW."investment_id" IS NULL THEN NEW."id" ELSE NULL END
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_claim_stellar_investment_payment"
      BEFORE INSERT OR UPDATE OF "transaction_hash", "stellar_operation_index"
      ON "investments"
      FOR EACH ROW EXECUTE FUNCTION "claim_stellar_investment_payment"();
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_claim_stellar_transaction_payment"
      BEFORE INSERT OR UPDATE OF "stellar_tx_hash", "stellar_operation_index", "investment_id"
      ON "transactions"
      FOR EACH ROW EXECUTE FUNCTION "claim_stellar_transaction_payment"();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_claim_stellar_transaction_payment" ON "transactions";`
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_claim_stellar_investment_payment" ON "investments";`
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "claim_stellar_transaction_payment"();`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "claim_stellar_investment_payment"();`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "claim_stellar_payment_operation"(varchar, integer, uuid, uuid);`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "stellar_payment_claims";`);
  }
}
