import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784792437520 implements MigrationInterface {
  name = 'InitialSchema1784792437520';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: ensure the uuid-ossp extension exists before any table that
    // uses uuid_generate_v4() as a column DEFAULT. On a truly fresh Postgres
    // volume (M7 prod container / CI service container) the extension is NOT
    // pre-installed, and migration:run would otherwise fail with
    // "function uuid_generate_v4() does not exist". Not dropped in down() to
    // avoid breaking other objects that may depend on it.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."eonet_events_status_enum" AS ENUM('open', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "eonet_events" ("id" character varying NOT NULL, "title" character varying NOT NULL, "description" text, "link" character varying NOT NULL, "status" "public"."eonet_events_status_enum" NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL, "geometry" jsonb, CONSTRAINT "PK_389f734bbcb68e7638198fbd187" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "eonet_categories" ("id" character varying NOT NULL, "title" character varying NOT NULL, "description" text, CONSTRAINT "PK_2e66861783e8e6ac34c1b8eaa48" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscribers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_id" uuid NOT NULL, "name" character varying NOT NULL, "discord_webhook_url" character varying NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "apod_enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cbe0a7a9256c826f403c0236b67" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_log_source_enum" AS ENUM('apod', 'eonet', 'test')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_log_status_enum" AS ENUM('sent', 'mocked', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subscriber_id" uuid NOT NULL, "source" "public"."notification_log_source_enum" NOT NULL, "reference_id" character varying NOT NULL, "payload" jsonb NOT NULL, "status" "public"."notification_log_status_enum" NOT NULL, "error" text, "delivered_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6f761cfbbd064e0f326960877d6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."apod_entries_media_type_enum" AS ENUM('image', 'video', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "apod_entries" ("date" date NOT NULL, "title" character varying NOT NULL, "explanation" text NOT NULL, "url" character varying NOT NULL, "media_type" "public"."apod_entries_media_type_enum" NOT NULL, "video_url" character varying, "copyright" character varying, "fetched_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_e4cefcae6bdcf67b8b81a7e749f" PRIMARY KEY ("date"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "eonet_event_categories" ("event_id" character varying NOT NULL, "category_id" character varying NOT NULL, CONSTRAINT "PK_a0211ba915346fde89e670d25fa" PRIMARY KEY ("event_id", "category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_372daad6e2a0b9ed541c8230e0" ON "eonet_event_categories" ("event_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_63f4c4e90f0d9c50c0524a5072" ON "eonet_event_categories" ("category_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "subscriber_categories" ("subscriber_id" uuid NOT NULL, "category_id" character varying NOT NULL, CONSTRAINT "PK_0f019a7d8af464020f01d027248" PRIMARY KEY ("subscriber_id", "category_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_aa10e21c46afdf5877d2a07d17" ON "subscriber_categories" ("subscriber_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d11a245fbfc06fbe51189bbde7" ON "subscriber_categories" ("category_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "subscribers" ADD CONSTRAINT "FK_c3a874cf82e6f6d82f3ed3b715b" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_log" ADD CONSTRAINT "FK_b148c2f452e71f22ffd3b99bd2e" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "eonet_event_categories" ADD CONSTRAINT "FK_372daad6e2a0b9ed541c8230e04" FOREIGN KEY ("event_id") REFERENCES "eonet_events"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "eonet_event_categories" ADD CONSTRAINT "FK_63f4c4e90f0d9c50c0524a50727" FOREIGN KEY ("category_id") REFERENCES "eonet_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriber_categories" ADD CONSTRAINT "FK_aa10e21c46afdf5877d2a07d17a" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriber_categories" ADD CONSTRAINT "FK_d11a245fbfc06fbe51189bbde72" FOREIGN KEY ("category_id") REFERENCES "eonet_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscriber_categories" DROP CONSTRAINT "FK_d11a245fbfc06fbe51189bbde72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriber_categories" DROP CONSTRAINT "FK_aa10e21c46afdf5877d2a07d17a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "eonet_event_categories" DROP CONSTRAINT "FK_63f4c4e90f0d9c50c0524a50727"`,
    );
    await queryRunner.query(
      `ALTER TABLE "eonet_event_categories" DROP CONSTRAINT "FK_372daad6e2a0b9ed541c8230e04"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_log" DROP CONSTRAINT "FK_b148c2f452e71f22ffd3b99bd2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscribers" DROP CONSTRAINT "FK_c3a874cf82e6f6d82f3ed3b715b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d11a245fbfc06fbe51189bbde7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa10e21c46afdf5877d2a07d17"`,
    );
    await queryRunner.query(`DROP TABLE "subscriber_categories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_63f4c4e90f0d9c50c0524a5072"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_372daad6e2a0b9ed541c8230e0"`,
    );
    await queryRunner.query(`DROP TABLE "eonet_event_categories"`);
    await queryRunner.query(`DROP TABLE "apod_entries"`);
    await queryRunner.query(
      `DROP TYPE "public"."apod_entries_media_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "notification_log"`);
    await queryRunner.query(
      `DROP TYPE "public"."notification_log_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."notification_log_source_enum"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "subscribers"`);
    await queryRunner.query(`DROP TABLE "eonet_categories"`);
    await queryRunner.query(`DROP TABLE "eonet_events"`);
    await queryRunner.query(`DROP TYPE "public"."eonet_events_status_enum"`);
  }
}
