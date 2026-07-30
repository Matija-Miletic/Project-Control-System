CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`actor_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_project_created_idx` ON `audit_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `client_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_row` integer NOT NULL,
	`activity_name` text NOT NULL,
	`start_date` text,
	`finish_date` text,
	`percent_complete` real,
	`criticality` text DEFAULT 'unknown' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_activity_source_idx` ON `client_activities` (`project_id`,`source_row`);--> statement-breakpoint
CREATE TABLE `costing_allocations` (
	`costing_line_id` text NOT NULL,
	`task_id` text NOT NULL,
	`allocated_hours` real NOT NULL,
	PRIMARY KEY(`costing_line_id`, `task_id`),
	FOREIGN KEY (`costing_line_id`) REFERENCES `costing_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `costing_allocations_task_idx` ON `costing_allocations` (`task_id`);--> statement-breakpoint
CREATE TABLE `costing_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row` integer NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`work_section` text NOT NULL,
	`package_name` text NOT NULL,
	`original_labour_value` real,
	`imported_budget_hours` real NOT NULL,
	`import_rate` real,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `costing_source_row_idx` ON `costing_lines` (`project_id`,`source_sheet`,`source_row`);--> statement-breakpoint
CREATE INDEX `costing_project_section_idx` ON `costing_lines` (`project_id`,`work_section`);--> statement-breakpoint
CREATE TABLE `daily_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`date` text NOT NULL,
	`workfront` text DEFAULT 'Whole project' NOT NULL,
	`labour_hours` real DEFAULT 0 NOT NULL,
	`units_completed` real DEFAULT 0 NOT NULL,
	`rework_hours` real DEFAULT 0 NOT NULL,
	`variation_id` text,
	`variation_status` text DEFAULT 'none' NOT NULL,
	`delay_reason` text,
	`notes` text DEFAULT '' NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variation_id`) REFERENCES `variations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_entries_dedupe_idx` ON `daily_entries` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `daily_entries_project_date_idx` ON `daily_entries` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `daily_entries_task_date_idx` ON `daily_entries` (`task_id`,`date`);--> statement-breakpoint
CREATE TABLE `holidays` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`project_id`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `material_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`component` text DEFAULT 'Package' NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`lead_time_working_days` integer DEFAULT 0 NOT NULL,
	`buffer_working_days` integer DEFAULT 0 NOT NULL,
	`target_need_date` text NOT NULL,
	`forecast_need_date` text,
	`manual_need_date` text,
	`suggested_order_date` text NOT NULL,
	`purchase_order_date` text,
	`confirmed_delivery_date` text,
	`status` text DEFAULT 'not-identified' NOT NULL,
	`critical` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `materials_project_status_idx` ON `material_packages` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `materials_project_need_idx` ON `material_packages` (`project_id`,`target_need_date`);--> statement-breakpoint
CREATE TABLE `material_tasks` (
	`material_id` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`material_id`, `task_id`),
	FOREIGN KEY (`material_id`) REFERENCES `material_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `material_tasks_task_idx` ON `material_tasks` (`task_id`);--> statement-breakpoint
CREATE TABLE `programme_mappings` (
	`client_activity_id` text NOT NULL,
	`task_id` text NOT NULL,
	`allocation_percent` real DEFAULT 1 NOT NULL,
	PRIMARY KEY(`client_activity_id`, `task_id`),
	FOREIGN KEY (`client_activity_id`) REFERENCES `client_activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `programme_mappings_task_idx` ON `programme_mappings` (`task_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client` text DEFAULT '' NOT NULL,
	`project_manager` text DEFAULT '' NOT NULL,
	`site_manager` text DEFAULT '' NOT NULL,
	`status_date` text NOT NULL,
	`original_start` text NOT NULL,
	`original_finish` text NOT NULL,
	`target_finish` text NOT NULL,
	`handover_date` text NOT NULL,
	`productive_hours_per_person` real DEFAULT 8 NOT NULL,
	`minimum_progress_percent` real DEFAULT 0.1 NOT NULL,
	`minimum_progress_units` real DEFAULT 3 NOT NULL,
	`near_critical_days` integer DEFAULT 5 NOT NULL,
	`display_mode` text DEFAULT 'hours' NOT NULL,
	`hourly_rate` real,
	`source_notes` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`status_date` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_project_created_idx` ON `snapshots` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`predecessor_task_id` text NOT NULL,
	`dependency_type` text DEFAULT 'FS' NOT NULL,
	`lag_working_days` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`task_id`, `predecessor_task_id`, `dependency_type`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`predecessor_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dependencies_predecessor_idx` ON `task_dependencies` (`predecessor_task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`work_package` text NOT NULL,
	`workfront` text DEFAULT 'Whole project' NOT NULL,
	`tracking_uom` text NOT NULL,
	`progress_method` text NOT NULL,
	`original_units` real NOT NULL,
	`approved_variation_units` real DEFAULT 0 NOT NULL,
	`original_budget_hours` real NOT NULL,
	`approved_variation_hours` real DEFAULT 0 NOT NULL,
	`assigned_staff` real DEFAULT 0 NOT NULL,
	`max_practical_crew` real,
	`target_start` text NOT NULL,
	`target_finish` text NOT NULL,
	`original_start` text NOT NULL,
	`original_finish` text NOT NULL,
	`criticality` text DEFAULT 'unknown' NOT NULL,
	`criticality_source` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'not-started' NOT NULL,
	`manual_forecast_rate` real,
	`manual_forecast_start` text,
	`manual_forecast_finish` text,
	`forecast_override_reason` text,
	`access_date` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_sort_idx` ON `tasks` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `tasks_project_finish_idx` ON `tasks` (`project_id`,`target_finish`);--> statement-breakpoint
CREATE TABLE `variation_allocations` (
	`variation_id` text NOT NULL,
	`task_id` text NOT NULL,
	`submitted_hours` real DEFAULT 0 NOT NULL,
	`approved_hours` real DEFAULT 0 NOT NULL,
	`approved_units` real DEFAULT 0 NOT NULL,
	`exposure_hours` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`variation_id`, `task_id`),
	FOREIGN KEY (`variation_id`) REFERENCES `variations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `variation_allocations_task_idx` ON `variation_allocations` (`task_id`);--> statement-breakpoint
CREATE TABLE `variations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'potential' NOT NULL,
	`submitted_hours` real DEFAULT 0 NOT NULL,
	`approved_hours` real DEFAULT 0 NOT NULL,
	`exposure_hours` real DEFAULT 0 NOT NULL,
	`critical_path_impact` text DEFAULT 'unknown' NOT NULL,
	`client_response_due` text,
	`instruction_reference` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `variations_project_status_idx` ON `variations` (`project_id`,`status`);