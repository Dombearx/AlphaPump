CREATE TABLE `sync_rejections` (
	`entity` text NOT NULL,
	`row_id` text NOT NULL,
	`reason` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`rejected_at` integer NOT NULL,
	`retry_after` integer NOT NULL,
	PRIMARY KEY(`entity`, `row_id`),
	CONSTRAINT "sync_rejections_entity_check" CHECK("entity" IN ('tag', 'exercise', 'cycle', 'set'))
);
