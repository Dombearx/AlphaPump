PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`nickname` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_seq` integer,
	`device_id` text,
	CONSTRAINT "users_role_check" CHECK("role" IN ('user', 'admin'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "email", "nickname", "role", "created_at", "updated_at", "deleted_at", "server_seq", "device_id") SELECT "id", "email", "nickname", "role", "created_at", "updated_at", "deleted_at", "server_seq", "device_id" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);