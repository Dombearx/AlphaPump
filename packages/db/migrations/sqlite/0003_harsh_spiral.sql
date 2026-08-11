CREATE TABLE `outbox` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`row_id` text NOT NULL,
	`queued_at` integer NOT NULL,
	CONSTRAINT "outbox_entity_check" CHECK("entity" IN ('tag', 'exercise', 'cycle', 'set'))
);
--> statement-breakpoint
CREATE INDEX `outbox_row_idx` ON `outbox` (`entity`,`row_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`pulled_at` integer,
	`pushed_at` integer,
	`last_error` text,
	CONSTRAINT "sync_state_singleton_check" CHECK("id" = 1)
);
