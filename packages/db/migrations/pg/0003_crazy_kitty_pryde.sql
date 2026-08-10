ALTER TABLE "users" ADD COLUMN "server_seq" bigint DEFAULT nextval('server_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX "users_server_seq_idx" ON "users" USING btree ("server_seq");