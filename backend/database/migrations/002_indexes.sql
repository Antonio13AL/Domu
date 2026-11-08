-- =============================================================
-- Migración 002_indexes.sql
-- =============================================================
--
-- 1. `idx_issues_community_state_created` se amplía con `id_issue`
--    (PK) como columna de desempate: el listado de incidencias
--    ordena por `created_at DESC, id_issue DESC` para que la
--    paginación sea estable y, sin la PK en el índice, MySQL tenía
--    que ordenar todas las filas de la comunidad en un filesort.
-- 2. `idx_issues_community_created` cubre el listado de incidencias
--    SIN filtro de estado (el caso por defecto del endpoint), que
--    antes ordenaba decenas de miles de filas.
-- 3. `idx_bookings_community_status` cubre el KPI de reservas
--    pendientes del panel, que leía 40.000 entradas de índice para
--    contar 10.000.
--
-- Los tres son aditivos: `001_init.sql` no se modifica y el
-- checksum de la migración 001 sigue intacto.
-- =============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -------------------------------------------------------------
-- 1 y 2. incidencias: ampliar el índice de listado y añadir el del
--         listado sin filtro de estado (una sola sentencia ALTER
--         para que el cambio sea atómico).
-- -------------------------------------------------------------
ALTER TABLE issues
  DROP INDEX idx_issues_community_state_created,
  ADD INDEX idx_issues_community_state_created (id_community, state, created_at DESC, id_issue DESC),
  ADD INDEX idx_issues_community_created (id_community, created_at DESC, id_issue DESC);

-- -------------------------------------------------------------
-- 3. reservas: KPI de pendientes por comunidad.
-- -------------------------------------------------------------
ALTER TABLE bookings
  ADD INDEX idx_bookings_community_status (id_community, status);
