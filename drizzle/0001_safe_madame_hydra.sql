CREATE TABLE `calendar_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`name` text NOT NULL,
	`treatment` text DEFAULT 'non-working' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_exceptions_project_start_idx` ON `calendar_exceptions` (`project_id`,`start_date`);--> statement-breakpoint
INSERT OR IGNORE INTO `calendar_exceptions`
  (`id`, `project_id`, `start_date`, `end_date`, `name`, `treatment`)
SELECT
  'CAL-' || `project_id` || '-' || `date`,
  `project_id`,
  `date`,
  `date`,
  `name`,
  'non-working'
FROM `holidays`;--> statement-breakpoint
CREATE TABLE `programme_day_values` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`date` text NOT NULL,
	`man_days` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `task_id`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `programme_day_values_project_date_idx` ON `programme_day_values` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `programme_day_values_task_date_idx` ON `programme_day_values` (`task_id`,`date`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `user_created` integer DEFAULT false NOT NULL;
