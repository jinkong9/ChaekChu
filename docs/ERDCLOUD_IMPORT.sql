-- ERDCloud DDL Import
-- 프로젝트: S15P21B102
-- 기준: docs/ERD.md
-- PostgreSQL의 JSONB·TIMESTAMPTZ는 ERDCloud 호환을 위해 TEXT·DATETIME으로 표현한다.

CREATE TABLE users (
    id UUID NOT NULL,
    oauth_provider VARCHAR(20) NOT NULL,
    oauth_subject VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    birth_year SMALLINT,
    gender VARCHAR(30),
    onboarding_status VARCHAR(20) NOT NULL,
    interest_tags TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_users_oauth UNIQUE (oauth_provider, oauth_subject),
    CONSTRAINT ck_users_oauth_provider CHECK (oauth_provider IN ('KAKAO', 'GOOGLE')),
    CONSTRAINT ck_users_onboarding_status CHECK (onboarding_status IN ('PENDING', 'COMPLETED'))
);

CREATE TABLE books (
    id UUID NOT NULL,
    isbn13 CHAR(13) NOT NULL,
    title VARCHAR(500) NOT NULL,
    authors TEXT NOT NULL,
    publisher VARCHAR(255),
    published_date DATE,
    description TEXT,
    tags TEXT NOT NULL,
    cover_image_url TEXT,
    page_count INTEGER,
    popularity_score DECIMAL(5, 2),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_books_isbn13 UNIQUE (isbn13),
    CONSTRAINT ck_books_page_count CHECK (page_count IS NULL OR page_count > 0),
    CONSTRAINT ck_books_popularity_score CHECK (popularity_score IS NULL OR popularity_score BETWEEN 0 AND 100)
);

CREATE TABLE library_items (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL,
    rating SMALLINT,
    review_text VARCHAR(300),
    finished_at DATE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_library_items_user_book UNIQUE (user_id, book_id),
    CONSTRAINT ck_library_items_status CHECK (status IN ('WISH', 'READING', 'READ')),
    CONSTRAINT ck_library_items_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT ck_library_items_finished_at CHECK ((status = 'READ' AND finished_at IS NOT NULL) OR (status <> 'READ' AND finished_at IS NULL)),
    CONSTRAINT fk_library_items_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_library_items_book FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE recommendations (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    mode VARCHAR(30) NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    weights TEXT NOT NULL,
    applied_tags TEXT NOT NULL,
    fallback BOOLEAN NOT NULL,
    generated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_recommendations_mode CHECK (mode IN ('COLD_START', 'PERSONALIZED')),
    CONSTRAINT fk_recommendations_user FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE recommendation_items (
    recommendation_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rank INTEGER NOT NULL,
    score DECIMAL(6, 2) NOT NULL,
    feature_scores TEXT NOT NULL,
    tags TEXT NOT NULL,
    reason_type VARCHAR(50) NOT NULL,
    reason_text VARCHAR(500) NOT NULL,
    PRIMARY KEY (recommendation_id, book_id),
    CONSTRAINT uq_recommendation_items_rank UNIQUE (recommendation_id, rank),
    CONSTRAINT ck_recommendation_items_rank CHECK (rank >= 1),
    CONSTRAINT ck_recommendation_items_score CHECK (score BETWEEN 0 AND 100),
    CONSTRAINT fk_recommendation_items_recommendation FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_recommendation_items_book FOREIGN KEY (book_id) REFERENCES books (id)
);
