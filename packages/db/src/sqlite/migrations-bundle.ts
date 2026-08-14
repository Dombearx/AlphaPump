/**
 * Migracje SQLite w formie, którą widzi bundler aplikacji mobilnej.
 *
 * PLIK GENEROWANY — nie edytuj ręcznie. Powstaje z katalogu
 * `migrations/sqlite` poleceniem `pnpm --filter @alphapump/db generate:bundle`,
 * a test `tests/sqlite-bundle.test.ts` sprawdza, że jest aktualny.
 */

export interface SqliteMigrationBundle {
  journal: {
    entries: {
      idx: number;
      when: number;
      tag: string;
      breakpoints: boolean;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  };
  /** Klucz `m0000`, `m0001`, … — takiego układu oczekuje migrator Drizzle. */
  migrations: Record<string, string>;
}

export const sqliteMigrationBundle: SqliteMigrationBundle = {
  journal: {
    "version": "7",
    "dialect": "sqlite",
    "entries": [
      {
        "idx": 0,
        "version": "6",
        "when": 1786375991382,
        "tag": "0000_stiff_tempest",
        "breakpoints": true
      },
      {
        "idx": 1,
        "version": "6",
        "when": 1786386183119,
        "tag": "0001_dry_changeling",
        "breakpoints": true
      },
      {
        "idx": 2,
        "version": "6",
        "when": 1786386477843,
        "tag": "0002_overconfident_red_skull",
        "breakpoints": true
      },
      {
        "idx": 3,
        "version": "6",
        "when": 1786432732511,
        "tag": "0003_harsh_spiral",
        "breakpoints": true
      },
      {
        "idx": 4,
        "version": "6",
        "when": 1786705791047,
        "tag": "0004_damp_nocturne",
        "breakpoints": true
      }
    ]
  },
  migrations: {
  m0000: "CREATE TABLE `cycle_goals` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`cycle_id` text NOT NULL,\n\t`metric` text NOT NULL,\n\t`target` integer NOT NULL,\n\t`exercise_id` text,\n\t`tag_id` text,\n\t`position` integer DEFAULT 0 NOT NULL,\n\tFOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"cycle_goals_metric_check\" CHECK(\"metric\" IN ('sets', 'duration', 'distance')),\n\tCONSTRAINT \"cycle_goals_target_check\" CHECK(\"target\" > 0),\n\tCONSTRAINT \"cycle_goals_scope_check\" CHECK((\"exercise_id\" IS NULL) <> (\"tag_id\" IS NULL))\n);\n--> statement-breakpoint\nCREATE INDEX `cycle_goals_cycle_idx` ON `cycle_goals` (`cycle_id`);--> statement-breakpoint\nCREATE TABLE `cycles` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`starts_on` text NOT NULL,\n\t`ends_on` text,\n\t`archived_at` integer,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"cycles_range_check\" CHECK(\"ends_on\" IS NULL OR \"ends_on\" >= \"starts_on\")\n);\n--> statement-breakpoint\nCREATE INDEX `cycles_user_idx` ON `cycles` (`user_id`);--> statement-breakpoint\nCREATE INDEX `cycles_server_seq_idx` ON `cycles` (`server_seq`);--> statement-breakpoint\nCREATE TABLE `exercise_tags` (\n\t`exercise_id` text NOT NULL,\n\t`tag_id` text NOT NULL,\n\t`position` integer DEFAULT 0 NOT NULL,\n\tPRIMARY KEY(`exercise_id`, `tag_id`),\n\tFOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,\n\tFOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action\n);\n--> statement-breakpoint\nCREATE INDEX `exercise_tags_tag_idx` ON `exercise_tags` (`tag_id`);--> statement-breakpoint\nCREATE TABLE `exercises` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`author_id` text NOT NULL,\n\t`logging_type` text NOT NULL,\n\t`primary_tag_id` text NOT NULL,\n\t`note` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer,\n\tFOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`primary_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"exercises_logging_type_check\" CHECK(\"logging_type\" IN ('weight_reps', 'weight_time', 'bodyweight_reps', 'bodyweight_time', 'distance_time'))\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `exercises_author_slug_unique` ON `exercises` (`author_id`,`slug`);--> statement-breakpoint\nCREATE INDEX `exercises_primary_tag_idx` ON `exercises` (`primary_tag_id`);--> statement-breakpoint\nCREATE INDEX `exercises_server_seq_idx` ON `exercises` (`server_seq`);--> statement-breakpoint\nCREATE TABLE `tags` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`slug` text NOT NULL,\n\t`color` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint\nCREATE INDEX `tags_server_seq_idx` ON `tags` (`server_seq`);--> statement-breakpoint\nCREATE TABLE `users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`email` text NOT NULL,\n\t`nickname` text NOT NULL,\n\t`role` text DEFAULT 'user' NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer,\n\tCONSTRAINT \"users_role_check\" CHECK(\"role\" IN ('user', 'admin'))\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint\nCREATE TABLE `workout_sets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`exercise_id` text NOT NULL,\n\t`performed_on` text NOT NULL,\n\t`position` integer DEFAULT 0 NOT NULL,\n\t`weight_g` integer,\n\t`reps` integer,\n\t`duration_s` integer,\n\t`distance_m` integer,\n\t`bodyweight_g` integer,\n\t`note` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"workout_sets_measurements_check\" CHECK(\"weight_g\" >= 0 AND \"reps\" > 0 AND \"duration_s\" > 0 AND \"distance_m\" > 0 AND \"bodyweight_g\" >= 0),\n\tCONSTRAINT \"workout_sets_position_check\" CHECK(\"position\" >= 0)\n);\n--> statement-breakpoint\nCREATE INDEX `workout_sets_user_day_idx` ON `workout_sets` (`user_id`,`performed_on`);--> statement-breakpoint\nCREATE INDEX `workout_sets_user_exercise_idx` ON `workout_sets` (`user_id`,`exercise_id`);--> statement-breakpoint\nCREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`exercise_id`);--> statement-breakpoint\nCREATE INDEX `workout_sets_server_seq_idx` ON `workout_sets` (`server_seq`);",
  m0001: "ALTER TABLE `cycles` ADD `device_id` text;--> statement-breakpoint\nALTER TABLE `exercises` ADD `device_id` text;--> statement-breakpoint\nALTER TABLE `tags` ADD `device_id` text;--> statement-breakpoint\nALTER TABLE `users` ADD `device_id` text;--> statement-breakpoint\nALTER TABLE `workout_sets` ADD `device_id` text;",
  m0002: "PRAGMA foreign_keys=OFF;--> statement-breakpoint\nCREATE TABLE `__new_users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`email` text,\n\t`nickname` text NOT NULL,\n\t`role` text DEFAULT 'user' NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`deleted_at` integer,\n\t`server_seq` integer,\n\t`device_id` text,\n\tCONSTRAINT \"users_role_check\" CHECK(\"role\" IN ('user', 'admin'))\n);\n--> statement-breakpoint\nINSERT INTO `__new_users`(\"id\", \"email\", \"nickname\", \"role\", \"created_at\", \"updated_at\", \"deleted_at\", \"server_seq\", \"device_id\") SELECT \"id\", \"email\", \"nickname\", \"role\", \"created_at\", \"updated_at\", \"deleted_at\", \"server_seq\", \"device_id\" FROM `users`;--> statement-breakpoint\nDROP TABLE `users`;--> statement-breakpoint\nALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint\nPRAGMA foreign_keys=ON;--> statement-breakpoint\nCREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);",
  m0003: "CREATE TABLE `outbox` (\n\t`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`entity` text NOT NULL,\n\t`row_id` text NOT NULL,\n\t`queued_at` integer NOT NULL,\n\tCONSTRAINT \"outbox_entity_check\" CHECK(\"entity\" IN ('tag', 'exercise', 'cycle', 'set'))\n);\n--> statement-breakpoint\nCREATE INDEX `outbox_row_idx` ON `outbox` (`entity`,`row_id`);--> statement-breakpoint\nCREATE TABLE `sync_state` (\n\t`id` integer PRIMARY KEY NOT NULL,\n\t`cursor` integer DEFAULT 0 NOT NULL,\n\t`pulled_at` integer,\n\t`pushed_at` integer,\n\t`last_error` text,\n\tCONSTRAINT \"sync_state_singleton_check\" CHECK(\"id\" = 1)\n);\n",
  m0004: "DROP INDEX `exercises_author_slug_unique`;--> statement-breakpoint\nALTER TABLE `exercises` ADD `gym` text;--> statement-breakpoint\nCREATE UNIQUE INDEX `exercises_author_slug_gym_unique` ON `exercises` (`author_id`,`slug`,coalesce(`gym`, ''));",
  },
};

export default sqliteMigrationBundle;
