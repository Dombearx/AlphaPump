-- Rozszerzenia warstwy wykrywania duplikatów (etap 12).
--
-- drizzle-kit nie generuje `CREATE EXTENSION` — zna typy i indeksy, nie zna
-- wymagań serwera. Dopisane ręcznie i **przed** resztą pliku, bo bez nich nie
-- istnieje ani typ `vector`, ani klasa operatorów `gin_trgm_ops`.
--
-- `IF NOT EXISTS`, bo migracja jedzie także na bazie, w której obraz Postgresa
-- miał je już włączone.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "duplicate_check_cache" (
	"query_slug" text NOT NULL,
	"candidates_fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"verdicts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_check_cache_pk" PRIMARY KEY("query_slug","candidates_fingerprint","model")
);
--> statement-breakpoint
CREATE TABLE "exercise_embeddings" (
	"exercise_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"source" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_embeddings" ADD CONSTRAINT "exercise_embeddings_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duplicate_check_cache_created_idx" ON "duplicate_check_cache" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "exercise_embeddings_hnsw_idx" ON "exercise_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "exercises_slug_trgm_idx" ON "exercises" USING gin ("slug" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "exercises_slug_fts_idx" ON "exercises" USING gin (to_tsvector('simple', replace("slug", '-', ' ')));