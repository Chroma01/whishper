DROP INDEX `media_derivatives_project_kind_unique`;--> statement-breakpoint
ALTER TABLE `media_derivatives` ADD `audio_track` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `media_derivatives_project_kind_track_unique` ON `media_derivatives` (`project_id`,`kind`,`audio_track`);