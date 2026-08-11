CREATE TABLE "exercise_records" (
	"exercise_id" text NOT NULL,
	"set_id" text NOT NULL,
	"user_id" text NOT NULL,
	"performed_on" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"weight_g" integer,
	"reps" integer,
	"duration_s" integer,
	"distance_m" integer,
	"note" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_records_pk" PRIMARY KEY("exercise_id","set_id")
);
--> statement-breakpoint
ALTER TABLE "exercise_records" ADD CONSTRAINT "exercise_records_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_records" ADD CONSTRAINT "exercise_records_set_id_workout_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."workout_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_records" ADD CONSTRAINT "exercise_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_records_exercise_idx" ON "exercise_records" USING btree ("exercise_id","position");--> statement-breakpoint
CREATE INDEX "exercise_records_user_idx" ON "exercise_records" USING btree ("user_id");