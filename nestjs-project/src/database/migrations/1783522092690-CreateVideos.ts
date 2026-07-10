import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1783522092690 implements MigrationInterface {
  name = 'CreateVideos1783522092690';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "short_code" character varying(12) NOT NULL, "storage_key" character varying NOT NULL, "thumbnail_key" character varying, "upload_id" character varying, "original_filename" character varying, "content_type" character varying, "size_bytes" bigint, "duration_seconds" numeric, "metadata" jsonb, "error_message" text, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_c8b38c8407b8c76434f8ed0e93c" UNIQUE ("short_code"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ece1558efc6efd53eb530479db" ON "videos" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ece1558efc6efd53eb530479db"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
