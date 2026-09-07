-- ERDCloud export (2026-09-07, 프론트 초기 구성 시 작성한 1차 ERD) — 원본 그대로 보존. 수정하지 않는다.
-- 보정 반영본은 V1__init.sql

CREATE TABLE `books` (
	`id`	BIGINT	NOT NULL,
	`isbn13`	VARCHAR(13)	NOT NULL,
	`title`	VARCHAR(500)	NOT NULL,
	`author`	VARCHAR(300)	NULL,
	`publisher`	VARCHAR(200)	NULL,
	`pub_year`	SMALLINT	NULL,
	`category_code`	VARCHAR(10)	NULL,
	`description`	TEXT	NULL,
	`cover_url`	VARCHAR(500)	NULL,
	`embedding_version`	VARCHAR(30)	NULL
);

CREATE TABLE `book_loaned_top20` (
	`id`	BIGINT	NOT NULL,
	`book_id`	BIGINT	NOT NULL,
	`gender`	VARCHAR(1)	NOT NULL,
	`age_group`	VARCHAR(2)	NOT NULL,
	`ranking`	SMALLINT	NOT NULL,
	`loan_count`	INT	NULL,
	`period`	VARCHAR(6)	NOT NULL
);

CREATE TABLE `recommendation_items` (
	`id`	BIGINT	NOT NULL,
	`recommendation_id`	BIGINT	NOT NULL,
	`book_id`	BIGINT	NOT NULL,
	`rank`	SMALLINT	NOT NULL,
	`score`	REAL	NULL,
	`tags`	JSONB	NULL,
	`feature_scores`	JSONB	NULL,
	`reason_text`	TEXT	NULL
);

CREATE TABLE `recommendations` (
	`id`	BIGINT	NOT NULL,
	`user_id`	BIGINT	NOT NULL,
	`input_tags`	JSONB	NULL,
	`feature_version`	VARCHAR(30)	NULL,
	`created_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now()
);

CREATE TABLE `user_library` (
	`id`	BIGINT	NOT NULL,
	`user_id`	BIGINT	NOT NULL,
	`book_id`	BIGINT	NOT NULL,
	`status`	VARCHAR(15)	NOT NULL,
	`rating`	SMALLINT	NULL,
	`review_text`	VARCHAR(300)	NULL,
	`finished_at`	DATE	NULL,
	`source`	VARCHAR(15)	NOT NULL	DEFAULT 'SERVICE',
	`created_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now(),
	`updated_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now()
);

CREATE TABLE `book_tags` (
	`id`	BIGINT	NOT NULL,
	`book_id`	BIGINT	NOT NULL,
	`tag_code`	VARCHAR(30)	NOT NULL
);

CREATE TABLE `tags` (
	`tag_code`	VARCHAR(30)	NOT NULL,
	`label`	VARCHAR(50)	NOT NULL,
	`kind`	VARCHAR(10)	NOT NULL
);

CREATE TABLE `user_actions` (
	`id`	BIGINT	NOT NULL,
	`user_id`	BIGINT	NOT NULL,
	`book_id`	BIGINT	NOT NULL,
	`event_type`	VARCHAR(15)	NOT NULL,
	`context`	VARCHAR(20)	NULL,
	`created_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now()
);

CREATE TABLE `user_interests` (
	`id`	BIGINT	NOT NULL,
	`user_id`	BIGINT	NOT NULL,
	`tag_code`	VARCHAR(30)	NOT NULL,
	`created_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now()
);

CREATE TABLE `users` (
	`id`	BIGINT	NOT NULL,
	`oauth_provider`	VARCHAR(20)	NOT NULL,
	`oauth_subject`	VARCHAR(255)	NOT NULL,
	`nickname`	VARCHAR(50)	NOT NULL,
	`birth_year`	SMALLINT	NULL,
	`gender`	VARCHAR(10)	NULL,
	`created_at`	TIMESTAMPTZ	NOT NULL	DEFAULT now()
);

ALTER TABLE `books` ADD CONSTRAINT `PK_BOOKS` PRIMARY KEY (`id`);
ALTER TABLE `book_loaned_top20` ADD CONSTRAINT `PK_BOOK_LOANED_TOP20` PRIMARY KEY (`id`);
ALTER TABLE `recommendation_items` ADD CONSTRAINT `PK_RECOMMENDATION_ITEMS` PRIMARY KEY (`id`);
ALTER TABLE `recommendations` ADD CONSTRAINT `PK_RECOMMENDATIONS` PRIMARY KEY (`id`);
ALTER TABLE `user_library` ADD CONSTRAINT `PK_USER_LIBRARY` PRIMARY KEY (`id`);
ALTER TABLE `book_tags` ADD CONSTRAINT `PK_BOOK_TAGS` PRIMARY KEY (`id`);
ALTER TABLE `tags` ADD CONSTRAINT `PK_TAGS` PRIMARY KEY (`tag_code`);
ALTER TABLE `user_actions` ADD CONSTRAINT `PK_USER_ACTIONS` PRIMARY KEY (`id`);
ALTER TABLE `user_interests` ADD CONSTRAINT `PK_USER_INTERESTS` PRIMARY KEY (`id`);
ALTER TABLE `users` ADD CONSTRAINT `PK_USERS` PRIMARY KEY (`id`);
