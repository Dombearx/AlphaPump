CREATE TABLE `cycle_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`metric` text NOT NULL,
	`target` integer NOT NULL,
	`exercise_id` text,
	`tag_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cycle_goals_metric_check" CHECK("metric" IN ('sets', 'duration', 'distance')),
	CONSTRAINT "cycle_goals_target_check" CHECK("target" > 0),
	CONSTRAINT "cycle_goals_scope_check" CHECK(("exercise_id" IS NULL) <> ("tag_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `cycle_goals_cycle_idx` ON `cycle_goals` (`cycle_id`);--> statement-breakpoint
CREATE TABLE `cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	CONSTRAINT "cycles_range_check" CHECK("ends_on" IS NULL OR "ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE INDEX `cycles_user_idx` ON `cycles` (`user_id`);--> statement-breakpoint
CREATE INDEX `cycles_server_seq_idx` ON `cycles` (`server_seq`);--> statement-breakpoint
CREATE TABLE `exercise_tags` (
	`exercise_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`exercise_id`, `tag_id`),
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exercise_tags_tag_idx` ON `exercise_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`author_id` text NOT NULL,
	`logging_type` text NOT NULL,
	`primary_tag_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	FOREIGN KEY (`primary_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercises_logging_type_check" CHECK("logging_type" IN ('weight_reps', 'weight_time', 'bodyweight_reps', 'bodyweight_time', 'distance_time'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_author_slug_unique` ON `exercises` (`author_id`,`slug`);--> statement-breakpoint
CREATE INDEX `exercises_primary_tag_idx` ON `exercises` (`primary_tag_id`);--> statement-breakpoint
CREATE INDEX `exercises_server_seq_idx` ON `exercises` (`server_seq`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint
CREATE INDEX `tags_server_seq_idx` ON `tags` (`server_seq`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`nickname` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	CONSTRAINT "users_role_check" CHECK("role" IN ('user', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`performed_on` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`weight_g` integer,
	`reps` integer,
	`duration_s` integer,
	`distance_m` integer,
	`bodyweight_g` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workout_sets_measurements_check" CHECK("weight_g" >= 0 AND "reps" > 0 AND "duration_s" > 0 AND "distance_m" > 0 AND "bodyweight_g" >= 0),
	CONSTRAINT "workout_sets_position_check" CHECK("position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `workout_sets_user_day_idx` ON `workout_sets` (`user_id`,`performed_on`);--> statement-breakpoint
CREATE INDEX `workout_sets_user_exercise_idx` ON `workout_sets` (`user_id`,`exercise_id`);--> statement-breakpoint
CREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `workout_sets_server_seq_idx` ON `workout_sets` (`server_seq`);