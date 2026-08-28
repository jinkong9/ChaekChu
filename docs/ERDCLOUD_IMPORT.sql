-- ERDCloud DDL Import
-- 프로젝트: S15P21B102
-- 기준: docs/ERD.md
-- PostgreSQL의 JSONB·TIMESTAMPTZ는 ERDCloud 호환을 위해 TEXT·DATETIME으로 표현한다.
-- ERDCloud의 가져오기(Import) > DDL 입력창에 이 파일 전체를 붙여 넣는다.

CREATE TABLE book_works (
    id UUID NOT NULL,
    canonical_title VARCHAR(500) NOT NULL,
    canonical_author VARCHAR(255),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE books (
    id UUID NOT NULL,
    work_id UUID,
    isbn13 CHAR(13) NOT NULL,
    isbn10 CHAR(10),
    title VARCHAR(500) NOT NULL,
    subtitle VARCHAR(500),
    authors TEXT NOT NULL,
    publisher VARCHAR(255),
    published_date DATE,
    description TEXT,
    categories TEXT NOT NULL,
    cover_image_url TEXT,
    page_count INTEGER,
    publication_form VARCHAR(50),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_books_isbn13 UNIQUE (isbn13),
    CONSTRAINT ck_books_page_count CHECK (page_count IS NULL OR page_count > 0),
    CONSTRAINT fk_books_work
        FOREIGN KEY (work_id) REFERENCES book_works (id)
);

CREATE TABLE book_source_records (
    id UUID NOT NULL,
    book_id UUID,
    source VARCHAR(50) NOT NULL,
    source_record_key VARCHAR(255) NOT NULL,
    source_book_id VARCHAR(255),
    isbn_raw VARCHAR(100),
    raw_payload_ref TEXT NOT NULL,
    validation_errors TEXT NOT NULL,
    collected_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_source_records_source_key UNIQUE (source, source_record_key),
    CONSTRAINT fk_book_source_records_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE tags (
    code VARCHAR(50) NOT NULL,
    label VARCHAR(100) NOT NULL,
    tag_type VARCHAR(20) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (code),
    CONSTRAINT uq_tags_label UNIQUE (label),
    CONSTRAINT ck_tags_type CHECK (tag_type IN ('GENRE', 'THEME', 'TONE', 'SIGNAL'))
);

CREATE TABLE book_demand_features (
    book_id UUID NOT NULL,
    as_of_month DATE NOT NULL,
    feature_version VARCHAR(50) NOT NULL,
    cumulative_loan_count BIGINT NOT NULL,
    loan_24m_count BIGINT NOT NULL,
    loan_3m_count BIGINT NOT NULL,
    observed_months SMALLINT NOT NULL,
    trending_score DECIMAL(6, 3) NOT NULL,
    steady_score DECIMAL(6, 3) NOT NULL,
    rank_score DECIMAL(20, 4) NOT NULL,
    candidate_type VARCHAR(30) NOT NULL,
    PRIMARY KEY (book_id, as_of_month, feature_version),
    CONSTRAINT ck_demand_counts_nonnegative CHECK (
        cumulative_loan_count >= 0 AND loan_24m_count >= 0 AND loan_3m_count >= 0
    ),
    CONSTRAINT ck_demand_observed_months CHECK (observed_months BETWEEN 0 AND 1200),
    CONSTRAINT ck_demand_scores_range CHECK (trending_score BETWEEN 0 AND 100 AND steady_score BETWEEN 0 AND 100),
    CONSTRAINT ck_demand_candidate_type CHECK (candidate_type IN ('DEMAND', 'NEW', 'DEMAND_AND_NEW')),
    CONSTRAINT fk_demand_features_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE book_content_features (
    book_id UUID NOT NULL,
    feature_scores TEXT NOT NULL,
    feature_version VARCHAR(50) NOT NULL,
    extracted_at DATETIME NOT NULL,
    PRIMARY KEY (book_id, feature_version),
    CONSTRAINT fk_content_features_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE book_tags (
    book_id UUID NOT NULL,
    tag_code VARCHAR(50) NOT NULL,
    feature_version VARCHAR(50) NOT NULL,
    score DECIMAL(5, 2),
    confidence DECIMAL(4, 3) NOT NULL,
    source VARCHAR(50) NOT NULL,
    PRIMARY KEY (book_id, tag_code, feature_version),
    CONSTRAINT ck_book_tags_score CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    CONSTRAINT ck_book_tags_confidence CHECK (confidence BETWEEN 0 AND 1),
    CONSTRAINT fk_book_tags_book FOREIGN KEY (book_id) REFERENCES books (id),
    CONSTRAINT fk_book_tags_tag FOREIGN KEY (tag_code) REFERENCES tags (code)
);

CREATE TABLE users (
    id UUID NOT NULL,
    oauth_provider VARCHAR(20) NOT NULL,
    oauth_subject VARCHAR(255) NOT NULL,
    email VARCHAR(320),
    nickname VARCHAR(100),
    birth_year SMALLINT,
    gender VARCHAR(30),
    onboarding_status VARCHAR(20) NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_users_oauth UNIQUE (oauth_provider, oauth_subject),
    CONSTRAINT ck_users_oauth_provider CHECK (oauth_provider IN ('KAKAO', 'GOOGLE')),
    CONSTRAINT ck_users_birth_year CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
    CONSTRAINT ck_users_onboarding_status CHECK (onboarding_status IN ('PENDING', 'COMPLETED', 'SKIPPED'))
);

CREATE TABLE user_interests (
    user_id UUID NOT NULL,
    tag_code VARCHAR(50) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, tag_code),
    CONSTRAINT fk_user_interests_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_interests_tag FOREIGN KEY (tag_code) REFERENCES tags (code)
);

CREATE TABLE user_seed_books (
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rating SMALLINT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, book_id),
    CONSTRAINT ck_user_seed_books_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT fk_user_seed_books_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_seed_books_book FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE library_items (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    status VARCHAR(30) NOT NULL,
    finished_at DATE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_library_items_user_book UNIQUE (user_id, book_id),
    CONSTRAINT ck_library_items_status CHECK (status IN ('WISH', 'READING', 'READ')),
    CONSTRAINT ck_library_items_finished_at CHECK ((status = 'READ' AND finished_at IS NOT NULL) OR (status <> 'READ' AND finished_at IS NULL)),
    CONSTRAINT fk_library_items_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_library_items_book FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE book_ratings (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rating SMALLINT NOT NULL,
    review_text VARCHAR(300),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_book_ratings_user_book UNIQUE (user_id, book_id),
    CONSTRAINT ck_book_ratings_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT fk_book_ratings_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_book_ratings_book FOREIGN KEY (book_id) REFERENCES books (id)
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
    score DECIMAL(20, 6) NOT NULL,
    feature_scores TEXT NOT NULL,
    tags TEXT NOT NULL,
    reason_type VARCHAR(50) NOT NULL,
    reason_text VARCHAR(500) NOT NULL,
    PRIMARY KEY (recommendation_id, book_id),
    CONSTRAINT uq_recommendation_items_rank UNIQUE (recommendation_id, rank),
    CONSTRAINT ck_recommendation_items_rank CHECK (rank >= 1),
    CONSTRAINT ck_recommendation_items_score CHECK (score BETWEEN 0 AND 100),
    CONSTRAINT ck_recommendation_items_reason_type CHECK (reason_type IN (
        'SAME_AUTHOR', 'SAME_CATEGORY', 'TEXT_SIMILARITY', 'SEGMENT_POPULAR',
        'DEMAND_POPULAR', 'MOMENTUM', 'NEW_BOOK', 'INITIAL_PREFERENCE'
    )),
    CONSTRAINT fk_recommendation_items_recommendation FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_recommendation_items_book FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE user_events (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    recommendation_id UUID,
    book_id UUID,
    event_type VARCHAR(30) NOT NULL,
    rank INTEGER,
    client_event_id VARCHAR(255),
    occurred_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_user_events_type CHECK (event_type IN ('IMPRESSION', 'CLICK', 'REASON_VIEW', 'BOOK_VIEW', 'WISH')),
    CONSTRAINT ck_user_events_target CHECK (
        (event_type IN ('IMPRESSION', 'CLICK', 'REASON_VIEW') AND recommendation_id IS NOT NULL) OR
        (event_type IN ('BOOK_VIEW', 'WISH') AND book_id IS NOT NULL)
    ),
    CONSTRAINT ck_user_events_rank CHECK (rank IS NULL OR rank >= 1),
    CONSTRAINT fk_user_events_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_events_recommendation FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_user_events_book FOREIGN KEY (book_id) REFERENCES books (id)
);
