-- =============================================================
-- Domu — Migración 001_init.sql
-- Esquema inicial de la base de datos
-- =============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -------------------------------------------------------------
-- 1. schema_migrations — control de migraciones
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename    VARCHAR(255)    NOT NULL,
  checksum    VARCHAR(64)     NOT NULL,
  applied_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 2. communities — comunidades
-- -------------------------------------------------------------
CREATE TABLE communities (
  id_community  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(150)    NOT NULL,
  address       VARCHAR(255)    NOT NULL,
  city          VARCHAR(100)    NOT NULL,
  postal_code   VARCHAR(10)     NOT NULL,
  invite_code   VARCHAR(12)     NOT NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_community),
  UNIQUE KEY uq_communities_invite_code (invite_code),
  KEY idx_communities_is_active (is_active),
  CONSTRAINT chk_communities_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 3. users — usuarios
-- -------------------------------------------------------------
CREATE TABLE users (
  id_user       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100)    NOT NULL,
  surname       VARCHAR(100)    NOT NULL,
  email         VARCHAR(255)    NOT NULL,
  password      VARCHAR(255)    NOT NULL,
  phone         VARCHAR(20)     NULL,
  role          VARCHAR(16)     NOT NULL DEFAULT 'NEIGHBOR',
  id_community  BIGINT UNSIGNED NULL,
  housing       VARCHAR(50)     NULL,
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_user),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_is_active (role, is_active),
  KEY idx_users_id_community (id_community),
  CONSTRAINT chk_users_role CHECK (role IN ('NEIGHBOR', 'PRESIDENT')),
  CONSTRAINT chk_users_is_active CHECK (is_active IN (0, 1)),
  CONSTRAINT fk_users_communities FOREIGN KEY (id_community)
    REFERENCES communities (id_community) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 4. issues — incidencias
-- -------------------------------------------------------------
CREATE TABLE issues (
  id_issue           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_community       BIGINT UNSIGNED NOT NULL,
  id_user            BIGINT UNSIGNED NOT NULL,
  title              VARCHAR(200)    NOT NULL,
  description        TEXT            NOT NULL,
  category           VARCHAR(16)     NULL,
  priority           VARCHAR(16)     NOT NULL DEFAULT 'MEDIUM',
  state              VARCHAR(16)     NOT NULL DEFAULT 'PENDING',
  resolved_at        DATETIME        NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_issue),
  KEY idx_issues_community_state_created (id_community, state, created_at DESC),
  KEY idx_issues_id_user (id_user),
  CONSTRAINT chk_issues_state CHECK (state IN ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
  CONSTRAINT chk_issues_priority CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  CONSTRAINT chk_issues_category CHECK (category IS NULL OR category IN ('PLUMBING', 'ELECTRICAL', 'ELEVATOR', 'CLEANING', 'SECURITY', 'OTHER')),
  CONSTRAINT fk_issues_communities FOREIGN KEY (id_community)
    REFERENCES communities (id_community) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_issues_users_author FOREIGN KEY (id_user)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 5. meetings — reuniones
-- -------------------------------------------------------------
CREATE TABLE meetings (
  id_meeting    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_community  BIGINT UNSIGNED NOT NULL,
  `date`        DATE            NOT NULL,
  start_time    TIME            NOT NULL,
  end_time      TIME            NOT NULL,
  title        VARCHAR(200)     NOT NULL,
  agenda        TEXT            NULL,
  minutes       TEXT            NULL,
  state         VARCHAR(16)     NOT NULL DEFAULT 'SCHEDULED', 
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_meeting),
  KEY idx_meetings_community_date (id_community, `date`),
  KEY idx_meetings_state (state),
  CONSTRAINT chk_meetings_state CHECK (state IN ('SCHEDULED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED')),
  CONSTRAINT chk_meetings_time CHECK (start_time < end_time),
  CONSTRAINT fk_meetings_communities FOREIGN KEY (id_community)
    REFERENCES communities (id_community) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 6. meeting_attendees — asistencia
-- -------------------------------------------------------------
CREATE TABLE meeting_attendees (
  id_meet_atte      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_meeting        BIGINT UNSIGNED NOT NULL,
  id_user           BIGINT UNSIGNED NOT NULL,
  attendance_status VARCHAR(16)     NOT NULL DEFAULT 'PENDING', 
  confirmed_at      DATETIME        NULL,
  PRIMARY KEY (id_meet_atte),
  UNIQUE KEY uq_meeting_attendees_meeting_user (id_meeting, id_user),
  KEY idx_meeting_attendees_user_id (id_user),
  CONSTRAINT chk_meeting_attendees_status CHECK (attendance_status IN ('PENDING', 'ATTENDED', 'ABSENT', 'EXCUSED')),
  CONSTRAINT fk_meeting_attendees_meetings FOREIGN KEY (id_meeting)
    REFERENCES meetings (id_meeting) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_meeting_attendees_users FOREIGN KEY (id_user)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 7. votes — votaciones
-- -------------------------------------------------------------
CREATE TABLE votes (
  id_vote      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_meeting   BIGINT UNSIGNED NOT NULL,
  created_by   BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(200)    NOT NULL,
  description  TEXT            NULL,
  status       VARCHAR(16)     NOT NULL DEFAULT 'DRAFT',
  opens_at     DATETIME        NULL,
  closes_at    DATETIME        NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_vote),
  KEY idx_votes_meeting_status (id_meeting, status),
  KEY idx_votes_opens_closes (opens_at, closes_at),
  KEY idx_votes_created_by (created_by),
  CONSTRAINT chk_votes_status CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
  CONSTRAINT chk_votes_window CHECK (opens_at < closes_at),
  CONSTRAINT fk_votes_meetings FOREIGN KEY (id_meeting)
    REFERENCES meetings (id_meeting) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_votes_users_creator FOREIGN KEY (created_by)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 8. vote_responses — votos emitidos
-- -------------------------------------------------------------
CREATE TABLE vote_responses (
  id_vot_res  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_vote     BIGINT UNSIGNED NOT NULL,
  id_user     BIGINT UNSIGNED NOT NULL,
  vote_option VARCHAR(16)     NOT NULL DEFAULT 'NULL',
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_vot_res),
  UNIQUE KEY uq_vote_responses_vote_user (id_vote, id_user),
  KEY idx_vote_responses_user_id (id_user),
  KEY idx_vote_responses_vote_option (vote_option),
  CONSTRAINT chk_votes_options CHECK (vote_option IN ('AGREE', 'DISAGREE', 'NULL')),
  CONSTRAINT fk_vote_responses_votes FOREIGN KEY (id_vote)
    REFERENCES votes (id_vote) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_vote_responses_users FOREIGN KEY (id_user)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------
-- 9. bookings — reservas de espacios
-- -------------------------------------------------------------
CREATE TABLE bookings (
  id_booking     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_community   BIGINT UNSIGNED NOT NULL,
  id_user        BIGINT UNSIGNED NOT NULL,
  space_name     VARCHAR(100)    NOT NULL,
  booking_date   DATE            NOT NULL,
  start_time     TIME            NOT NULL,
  end_time       TIME            NOT NULL,
  status         VARCHAR(16)     NOT NULL DEFAULT 'PENDING', 
  notes          TEXT            NULL,
  reviewed_by    BIGINT UNSIGNED NULL,
  reviewed_at    DATETIME        NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id_booking),
  KEY idx_bookings_community_date_space_status (id_community, booking_date, space_name, status),
  KEY idx_bookings_user_status (id_user, status),
  KEY idx_bookings_reviewed_by (reviewed_by),
  CONSTRAINT chk_bookings_status CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'REJECTED')),
  CONSTRAINT chk_bookings_time CHECK (start_time < end_time),
  CONSTRAINT fk_bookings_communities FOREIGN KEY (id_community)
    REFERENCES communities (id_community) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_bookings_users FOREIGN KEY (id_user)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_bookings_users_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id_user) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
