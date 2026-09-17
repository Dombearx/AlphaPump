ALTER TABLE "cycle_goals" DROP CONSTRAINT "cycle_goals_scope_check";--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD COLUMN "stretch_target" integer;--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD COLUMN "intensity" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "intensity" text;--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_stretch_target_check" CHECK ("stretch_target" IS NULL OR "stretch_target" > "target");--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_intensity_check" CHECK ("intensity" IS NULL OR "intensity" IN ('low', 'moderate', 'high'));--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_scope_check" CHECK ((CASE WHEN "exercise_id" IS NULL THEN 0 ELSE 1 END + CASE WHEN "tag_id" IS NULL THEN 0 ELSE 1 END + CASE WHEN "intensity" IS NULL THEN 0 ELSE 1 END) = 1);--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_intensity_check" CHECK ("intensity" IS NULL OR "intensity" IN ('low', 'moderate', 'high'));