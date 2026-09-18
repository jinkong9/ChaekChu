-- Anonymous book-world-cup summaries and per-user server-authoritative brackets.
CREATE TABLE book_world_cup_synopses (
    isbn13          CHAR(13)      NOT NULL,
    loan_rank       SMALLINT      NOT NULL,
    loan_count      BIGINT        NOT NULL,
    synopsis        TEXT          NOT NULL,
    source_hash     CHAR(64)      NOT NULL,
    input_hash      CHAR(64)      NOT NULL,
    source_name     VARCHAR(40)   NOT NULL,
    source_period   VARCHAR(20),
    selection_rule  VARCHAR(64)   NOT NULL,
    summary_version VARCHAR(64)   NOT NULL,
    model_version   VARCHAR(64)   NOT NULL,
    generated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (isbn13),
    CONSTRAINT uq_wc_synopsis_loan_rank UNIQUE (loan_rank),
    CONSTRAINT ck_wc_synopsis_rank CHECK (loan_rank >= 1),
    CONSTRAINT ck_wc_synopsis_loan_count CHECK (loan_count >= 0),
    CONSTRAINT ck_wc_synopsis_text CHECK (btrim(synopsis) <> ''),
    CONSTRAINT fk_wc_synopsis_book FOREIGN KEY (isbn13) REFERENCES books (isbn13) ON DELETE CASCADE
);

CREATE TABLE book_world_cup_sessions (
    session_id          UUID         NOT NULL,
    user_id             BIGINT       NOT NULL,
    status              VARCHAR(12)  NOT NULL,
    round_size          SMALLINT     NOT NULL,
    round_number        SMALLINT     NOT NULL DEFAULT 1,
    match_index         SMALLINT     NOT NULL DEFAULT 0,
    round_participants  JSONB        NOT NULL,
    round_winners       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    champion_isbn13     CHAR(13),
    expires_at          TIMESTAMPTZ  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id),
    CONSTRAINT ck_wc_session_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT ck_wc_session_round_size CHECK (round_size >= 2 AND (round_size & (round_size - 1)) = 0),
    CONSTRAINT ck_wc_session_round_number CHECK (round_number >= 1),
    CONSTRAINT ck_wc_session_match_index CHECK (match_index >= 0),
    CONSTRAINT ck_wc_session_participants CHECK (jsonb_typeof(round_participants) = 'array'),
    CONSTRAINT ck_wc_session_winners CHECK (jsonb_typeof(round_winners) = 'array'),
    CONSTRAINT fk_wc_session_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_wc_session_champion FOREIGN KEY (champion_isbn13) REFERENCES books (isbn13)
);
CREATE INDEX idx_wc_session_user_created ON book_world_cup_sessions (user_id, created_at DESC);
CREATE INDEX idx_wc_session_expiry ON book_world_cup_sessions (expires_at);
