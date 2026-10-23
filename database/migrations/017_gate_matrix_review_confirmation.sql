-- Current explicit Applicability Matrix confirmation for each Project or Package Gate.
-- Historical confirmations are frozen in gate_review_cycle.frozen_evidence.

CREATE TABLE gate_matrix_review_confirmation (
  gate_id text PRIMARY KEY,
  project_id text NOT NULL,
  package_id text,
  scope_level text NOT NULL CHECK (scope_level IN ('project', 'package')),
  review_scope text NOT NULL CHECK (review_scope IN ('next_stage', 'final_lifecycle')),
  target_stage_id text,
  matrix_fingerprint text NOT NULL CHECK (matrix_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status = 'confirmed'),
  confirmed_at timestamptz NOT NULL,
  confirmed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  confirmed_by_display_name text NOT NULL CHECK (btrim(confirmed_by_display_name) <> ''),
  confirmed_by_email text NOT NULL CHECK (btrim(confirmed_by_email) <> ''),
  FOREIGN KEY (gate_id, project_id, scope_level)
    REFERENCES gate(id, project_id, scope_level)
    ON DELETE CASCADE,
  FOREIGN KEY (gate_id, package_id)
    REFERENCES gate(id, package_id)
    ON DELETE CASCADE,
  CHECK (
    (scope_level = 'project' AND package_id IS NULL)
    OR (scope_level = 'package' AND package_id IS NOT NULL)
  ),
  CHECK (
    (review_scope = 'next_stage' AND target_stage_id IS NOT NULL)
    OR (review_scope = 'final_lifecycle' AND target_stage_id IS NULL)
  )
);

CREATE INDEX gate_matrix_review_confirmation_scope_idx
  ON gate_matrix_review_confirmation(project_id, package_id);
