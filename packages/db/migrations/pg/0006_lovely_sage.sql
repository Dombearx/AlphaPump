DROP INDEX "exercises_author_slug_unique";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "gym" text;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_author_slug_gym_unique" ON "exercises" USING btree ("author_id","slug",coalesce("gym", ''));