-- ERDCloud DDL Import
-- 프로젝트: S15P21B102
-- 기준: docs/ERD.md
--
-- ERDCloud의 가져오기(Import) > DDL 입력창에 이 파일 전체를 붙여 넣는다.
-- authors, categories, validation_errors는 ERDCloud 호환을 위해 TEXT로 표현했다.
-- 실제 PostgreSQL 구현에서는 각각 TEXT[]/JSONB 등으로 결정할 수 있다.
-- library_holding_snapshots와 book_demand_features는 대용량 분석 영역의
-- 논리 모델이며, 실제 물리 저장소에서는 Parquet/분석 DB를 우선 사용할 수 있다.

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
    categories TEXT,
    cover_image_url TEXT,
    page_count INTEGER,
    publication_form VARCHAR(50),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_books_isbn13 UNIQUE (isbn13),
    CONSTRAINT fk_books_work
        FOREIGN KEY (work_id) REFERENCES book_works (id)
);

CREATE TABLE book_source_records (
    id UUID NOT NULL,
    book_id UUID,
    source VARCHAR(50) NOT NULL,
    source_book_id VARCHAR(255),
    isbn_raw VARCHAR(100),
    raw_payload_ref TEXT NOT NULL,
    validation_errors TEXT,
    collected_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_book_source_records_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE libraries (
    id UUID NOT NULL,
    source_site_id VARCHAR(100),
    api_libcode VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    address VARCHAR(500),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    phone VARCHAR(50),
    latest_month CHAR(7) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_libraries_api_libcode UNIQUE (api_libcode)
);

CREATE TABLE library_holding_snapshots (
    library_id UUID NOT NULL,
    isbn13 CHAR(13) NOT NULL,
    snapshot_month CHAR(7) NOT NULL,
    cumulative_loan_count BIGINT NOT NULL,
    copy_count INTEGER NOT NULL,
    PRIMARY KEY (library_id, isbn13, snapshot_month),
    CONSTRAINT fk_holding_snapshots_library
        FOREIGN KEY (library_id) REFERENCES libraries (id),
    CONSTRAINT fk_holding_snapshots_book
        FOREIGN KEY (isbn13) REFERENCES books (isbn13)
);

CREATE TABLE book_demand_features (
    isbn13 CHAR(13) NOT NULL,
    cumulative_loan_count BIGINT NOT NULL,
    loan_24m_count BIGINT NOT NULL,
    loan_3m_count BIGINT NOT NULL,
    rank_score DECIMAL(20, 4) NOT NULL,
    candidate_type VARCHAR(30) NOT NULL,
    as_of_month CHAR(7) NOT NULL,
    feature_version VARCHAR(50) NOT NULL,
    PRIMARY KEY (isbn13),
    CONSTRAINT fk_demand_features_book
        FOREIGN KEY (isbn13) REFERENCES books (isbn13)
);

CREATE TABLE users (
    id UUID NOT NULL,
    email VARCHAR(320) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    birth_year SMALLINT,
    gender VARCHAR(30),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE user_interests (
    user_id UUID NOT NULL,
    category VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, category),
    CONSTRAINT fk_user_interests_user
        FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE user_seed_books (
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rating SMALLINT NOT NULL,
    review_text VARCHAR(300),
    created_at DATETIME NOT NULL,
    PRIMARY KEY (user_id, book_id),
    CONSTRAINT fk_user_seed_books_user
        FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_seed_books_book
        FOREIGN KEY (book_id) REFERENCES books (id)
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
    CONSTRAINT fk_library_items_user
        FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_library_items_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE book_ratings (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rating SMALLINT NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_book_ratings_user_book UNIQUE (user_id, book_id),
    CONSTRAINT fk_book_ratings_user
        FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_book_ratings_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE recommendations (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    generated_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_recommendations_user
        FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE recommendation_items (
    recommendation_id UUID NOT NULL,
    book_id UUID NOT NULL,
    rank INTEGER NOT NULL,
    score DECIMAL(20, 6) NOT NULL,
    reason_type VARCHAR(50) NOT NULL,
    reason_text VARCHAR(500) NOT NULL,
    PRIMARY KEY (recommendation_id, book_id),
    CONSTRAINT uq_recommendation_items_rank UNIQUE (recommendation_id, rank),
    CONSTRAINT fk_recommendation_items_recommendation
        FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_recommendation_items_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);

CREATE TABLE user_events (
    id UUID NOT NULL,
    user_id UUID,
    recommendation_id UUID,
    book_id UUID,
    event_type VARCHAR(30) NOT NULL,
    rank INTEGER,
    client_event_id VARCHAR(255),
    occurred_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_user_events_user
        FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_user_events_recommendation
        FOREIGN KEY (recommendation_id) REFERENCES recommendations (id),
    CONSTRAINT fk_user_events_book
        FOREIGN KEY (book_id) REFERENCES books (id)
);
