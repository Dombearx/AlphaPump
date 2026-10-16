PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`author_id` text NOT NULL,
	`logging_type` text NOT NULL,
	`primary_tag_id` text NOT NULL,
	`note` text,
	`gym` text,
	`translations` text,
	`intensity` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	`device_id` text,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercises_logging_type_check" CHECK("logging_type" IN ('weight_reps', 'weight_time', 'bodyweight_reps', 'bodyweight_time', 'distance_time', 'time'))
);
--> statement-breakpoint
INSERT INTO `__new_exercises`("id", "name", "slug", "author_id", "logging_type", "primary_tag_id", "note", "gym", "translations", "intensity", "created_at", "updated_at", "deleted_at", "server_seq", "device_id") SELECT "id", "name", "slug", "author_id", "logging_type", "primary_tag_id", "note", "gym", "translations", "intensity", "created_at", "updated_at", "deleted_at", "server_seq", "device_id" FROM `exercises`;--> statement-breakpoint
DROP TABLE `exercises`;--> statement-breakpoint
ALTER TABLE `__new_exercises` RENAME TO `exercises`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Wyrażenie `coalesce` poprawione ręcznie: drizzle-kit przy odtwarzaniu tabeli
-- rozcina je na przecinku i obkłada backtickami, przez co indeks nie wstaje.
-- Ta sama postać, co w migracji 0004, która ten indeks zakładała.
CREATE UNIQUE INDEX `exercises_author_slug_gym_unique` ON `exercises` (`author_id`,`slug`,coalesce(`gym`, ''));--> statement-breakpoint
CREATE INDEX `exercises_primary_tag_idx` ON `exercises` (`primary_tag_id`);--> statement-breakpoint
CREATE INDEX `exercises_server_seq_idx` ON `exercises` (`server_seq`);