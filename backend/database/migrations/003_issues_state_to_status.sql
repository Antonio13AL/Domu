-- ==============================================================
-- 003_issues_state_to_status.sql
-- Alineación de la tabla `issues` con la decisión de nomenclatura:
--
--   · Estado de incidencia `status` (se descarta `state`).
-- ==============================================================

-- Estado de incidencia: `state` -> `status` (CHECK con nombre nuevo).
ALTER TABLE issues DROP CHECK chk_issues_state;
ALTER TABLE issues RENAME COLUMN state TO status;
ALTER TABLE issues ADD CONSTRAINT chk_issues_status
  CHECK (status IN ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'));
