CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_unique" ON "rate_limits" USING btree ("key");