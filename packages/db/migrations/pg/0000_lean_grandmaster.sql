CREATE SEQUENCE "public"."server_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "cycle_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"metric" text NOT NULL,
	"target" integer NOT NULL,
	"exercise_id" text,
	"tag_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cycle_goals_metric_check" CHECK ("metric" IN ('sets', 'duration', 'distance')),
	CONSTRAINT "cycle_goals_target_check" CHECK ("target" > 0),
	CONSTRAINT "cycle_goals_scope_check" CHECK (("exercise_id" IS NULL) <> ("tag_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	CONSTRAINT "cycles_range_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE TABLE "exercise_tags" (
	"exercise_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "exercise_tags_pk" PRIMARY KEY("exercise_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"author_id" text NOT NULL,
	"logging_type" text NOT NULL,
	"primary_tag_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	CONSTRAINT "exercises_logging_type_check" CHECK ("logging_type" IN ('weight_reps', 'weight_time', 'bodyweight_reps', 'bodyweight_time', 'distance_time'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"nickname" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "workout_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"performed_on" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"weight_g" integer,
	"reps" integer,
	"duration_s" integer,
	"distance_m" integer,
	"bodyweight_g" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('server_seq') NOT NULL,
	CONSTRAINT "workout_sets_measurements_check" CHECK ("weight_g" >= 0 AND "reps" > 0 AND "duration_s" > 0 AND "distance_m" > 0 AND "bodyweight_g" >= 0),
	CONSTRAINT "workout_sets_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_goals" ADD CONSTRAINT "cycle_goals_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tags" ADD CONSTRAINT "exercise_tags_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_tags" ADD CONSTRAINT "exercise_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_primary_tag_id_tags_id_fk" FOREIGN KEY ("primary_tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_goals_cycle_idx" ON "cycle_goals" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "cycles_user_idx" ON "cycles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cycles_server_seq_idx" ON "cycles" USING btree ("server_seq");--> statement-breakpoint
CREATE INDEX "exercise_tags_tag_idx" ON "exercise_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_author_slug_unique" ON "exercises" USING btree ("author_id","slug");--> statement-breakpoint
CREATE INDEX "exercises_primary_tag_idx" ON "exercises" USING btree ("primary_tag_id");--> statement-breakpoint
CREATE INDEX "exercises_server_seq_idx" ON "exercises" USING btree ("server_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tags_server_seq_idx" ON "tags" USING btree ("server_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workout_sets_user_day_idx" ON "workout_sets" USING btree ("user_id","performed_on");--> statement-breakpoint
CREATE INDEX "workout_sets_user_exercise_idx" ON "workout_sets" USING btree ("user_id","exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sets_exercise_idx" ON "workout_sets" USING btree ("exercise_id");--> statement-breakpoint
CREATE INDEX "workout_sets_server_seq_idx" ON "workout_sets" USING btree ("server_seq");