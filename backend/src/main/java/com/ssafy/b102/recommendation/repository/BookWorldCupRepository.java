package com.ssafy.b102.recommendation.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Offline GMS synopsis pool and server-authoritative tournament state. */
@Repository
public class BookWorldCupRepository {
	public record Candidate(String isbn13, String synopsis) { }
	public record SessionRow(UUID sessionId, String status, int roundSize, int roundNumber, int matchIndex,
		String participantsJson, String winnersJson, String championIsbn13, Instant expiresAt) { }

	private final JdbcClient jdbc;

	public BookWorldCupRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public List<Candidate> sampleCandidates(int limit) {
		return jdbc.sql("""
				select isbn13, synopsis
				from book_world_cup_synopses
				order by random()
				limit :limit""")
			.param("limit", limit)
			.query((rs, rowNum) -> new Candidate(rs.getString("isbn13").trim(), rs.getString("synopsis")))
			.list();
	}

	public void deleteExpiredSessions(Instant now) {
		jdbc.sql("delete from book_world_cup_sessions where expires_at < :now")
			.param("now", java.sql.Timestamp.from(now)).update();
	}

	public Optional<String> findSynopsis(String isbn13) {
		return jdbc.sql("select synopsis from book_world_cup_synopses where isbn13 = :isbn13")
			.param("isbn13", isbn13)
			.query(String.class).optional();
	}

	public void insertSession(UUID sessionId, long userId, int roundSize, String participantsJson, Instant expiresAt) {
		jdbc.sql("""
				insert into book_world_cup_sessions
				    (session_id, user_id, status, round_size, round_number, match_index, round_participants, round_winners, expires_at)
				values
				    (:id, :userId, 'IN_PROGRESS', :roundSize, 1, 0, cast(:participants as jsonb), '[]'::jsonb, :expiresAt)""")
			.param("id", sessionId).param("userId", userId).param("roundSize", roundSize)
			.param("participants", participantsJson).param("expiresAt", java.sql.Timestamp.from(expiresAt)).update();
	}

	/** Row lock serializes picks; a repeated or concurrent pick cannot advance a matchup twice. */
	public Optional<SessionRow> findOwnedForUpdate(UUID sessionId, long userId) {
		return jdbc.sql("""
				select session_id, status, round_size, round_number, match_index,
				       round_participants::text as participants, round_winners::text as winners,
				       champion_isbn13, expires_at
				from book_world_cup_sessions
				where session_id = :sessionId and user_id = :userId
				for update""")
			.param("sessionId", sessionId).param("userId", userId)
			.query((rs, rowNum) -> mapSession(rs)).optional();
	}

	public void updateSession(UUID sessionId, String status, int roundSize, int roundNumber, int matchIndex,
		String participantsJson, String winnersJson, String championIsbn13) {
		jdbc.sql("""
				update book_world_cup_sessions
				set status = :status, round_size = :roundSize, round_number = :roundNumber, match_index = :matchIndex,
			    round_participants = cast(:participants as jsonb), round_winners = cast(:winners as jsonb),
			    champion_isbn13 = :champion, updated_at = now()
				where session_id = :sessionId""")
			.param("status", status).param("roundSize", roundSize).param("roundNumber", roundNumber)
			.param("matchIndex", matchIndex).param("participants", participantsJson).param("winners", winnersJson)
			.param("champion", championIsbn13).param("sessionId", sessionId).update();
	}

	private static SessionRow mapSession(ResultSet rs) throws SQLException {
		return new SessionRow(rs.getObject("session_id", UUID.class), rs.getString("status"), rs.getInt("round_size"),
			rs.getInt("round_number"), rs.getInt("match_index"), rs.getString("participants"), rs.getString("winners"),
			rs.getString("champion_isbn13") == null ? null : rs.getString("champion_isbn13").trim(), rs.getTimestamp("expires_at").toInstant());
	}
}
