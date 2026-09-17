PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cycle_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`metric` text NOT NULL,
	`target` integer NOT NULL,
	`stretch_target` integer,
	`exercise_id` text,
	`tag_id` text,
	`intensity` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_goals_metric_check" CHECK("metric" IN ('sets', 'duration', 'distance')),
	CONSTRAINT "cycle_goals_target_check" CHECK("target" > 0),
	CONSTRAINT "cycle_goals_stretch_target_check" CHECK("stretch_target" IS NULL OR "stretch_target" > "target"),
	CONSTRAINT "cycle_goals_intensity_check" CHECK("intensity" IS NULL OR "intensity" IN ('low', 'moderate', 'high')),
	CONSTRAINT "cycle_goals_scope_check" CHECK((CASE WHEN "exercise_id" IS NULL THEN 0 ELSE 1 END + CASE WHEN "tag_id" IS NULL THEN 0 ELSE 1 END + CASE WHEN "intensity" IS NULL THEN 0 ELSE 1 END) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_cycle_goals`("id", "cycle_id", "metric", "target", "stretch_target", "exercise_id", "tag_id", "intensity", "position") SELECT "id", "cycle_id", "metric", "target", NULL, "exercise_id", "tag_id", NULL, "position" FROM `cycle_goals`;--> statement-breakpoint
DROP TABLE `cycle_goals`;--> statement-breakpoint
ALTER TABLE `__new_cycle_goals` RENAME TO `cycle_goals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cycle_goals_cycle_idx` ON `cycle_goals` (`cycle_id`);--> statement-breakpoint
ALTER TABLE `exercises` ADD `intensity` text;