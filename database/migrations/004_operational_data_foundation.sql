CREATE TABLE project (
  id text PRIMARY KEY,
  project_number text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  project_manager text NOT NULL,
  customer text NOT NULL,
  reports_to text NOT NULL,
  site_location text NOT NULL,
  planned_start_date date,
  planned_completion_date date,
  validation_required boolean NOT NULL,
  current_stage text NOT NULL CHECK (
    current_stage IN ('initiation', 'definition_design', 'delivery', 'validation', 'closure')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  CHECK (validation_required OR current_stage <> 'validation')
);

CREATE INDEX project_archived_at_idx ON project(archived_at);

CREATE TABLE project_membership (
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_membership_user_id_idx ON project_membership(user_id);

CREATE TABLE governance_tier (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL,
  UNIQUE (project_id, sequence),
  UNIQUE (id, project_id)
);

CREATE UNIQUE INDEX governance_tier_project_name_idx
  ON governance_tier(project_id, lower(name));

CREATE TABLE project_package (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  package_code text NOT NULL CHECK (btrim(package_code) <> ''),
  package_name text NOT NULL CHECK (btrim(package_name) <> ''),
  description text NOT NULL,
  package_owner text NOT NULL CHECK (btrim(package_owner) <> ''),
  execution_model text CHECK (execution_model IS NULL OR execution_model IN ('internal', 'external')),
  current_stage text NOT NULL CHECK (
    current_stage IN ('definition', 'tendering', 'procurement', 'execution', 'closure')
  ),
  status text NOT NULL CHECK (status IN ('not_assessed', 'green', 'amber', 'red')),
  target_delivery_date date,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  UNIQUE (id, project_id)
);

CREATE UNIQUE INDEX project_package_code_idx
  ON project_package(project_id, lower(package_code));
CREATE INDEX project_package_project_id_idx ON project_package(project_id);
CREATE INDEX project_package_archived_at_idx ON project_package(archived_at);

CREATE TABLE gate (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  package_id text,
  scope_level text NOT NULL CHECK (scope_level IN ('project', 'package')),
  sequence integer NOT NULL CHECK (sequence > 0),
  template_version integer NOT NULL CHECK (template_version > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  stage_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'not_submitted',
      'submitted_for_approval',
      'approved',
      'approved_with_actions',
      'returned_for_rework'
    )
  ),
  UNIQUE (id, project_id),
  UNIQUE (id, package_id),
  UNIQUE (id, project_id, scope_level),
  UNIQUE (project_id, package_id, sequence),
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id)
    ON DELETE CASCADE,
  CHECK (
    (scope_level = 'project' AND package_id IS NULL AND stage_id IN (
      'initiation', 'definition_design', 'delivery', 'validation', 'closure'
    ))
    OR
    (scope_level = 'package' AND package_id IS NOT NULL AND stage_id IN (
      'definition', 'tendering', 'procurement', 'execution', 'closure'
    ))
  )
);

CREATE UNIQUE INDEX gate_scope_stage_idx
  ON gate(project_id, coalesce(package_id, ''), stage_id);
CREATE UNIQUE INDEX gate_scope_sequence_idx
  ON gate(project_id, coalesce(package_id, ''), sequence);
CREATE INDEX gate_project_id_idx ON gate(project_id);
CREATE INDEX gate_package_id_idx ON gate(package_id) WHERE package_id IS NOT NULL;

CREATE TABLE gate_criterion (
  id text PRIMARY KEY,
  gate_id text NOT NULL REFERENCES gate(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  template_id text,
  description text NOT NULL CHECK (btrim(description) <> ''),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'not_applicable')),
  UNIQUE (id, gate_id),
  UNIQUE (gate_id, sequence),
  UNIQUE (gate_id, template_id)
);

CREATE INDEX gate_criterion_gate_id_idx ON gate_criterion(gate_id);

CREATE TABLE gate_approver (
  id text PRIMARY KEY,
  gate_id text NOT NULL REFERENCES gate(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  email text NOT NULL CHECK (btrim(email) <> ''),
  role_function text NOT NULL CHECK (btrim(role_function) <> ''),
  approval_role text NOT NULL CHECK (btrim(approval_role) <> ''),
  approval_level integer NOT NULL CHECK (approval_level > 0),
  UNIQUE (gate_id, sequence)
);

CREATE INDEX gate_approver_gate_id_idx ON gate_approver(gate_id);

CREATE TABLE deliverable (
  id text PRIMARY KEY,
  template_id text,
  template_version integer CHECK (template_version IS NULL OR template_version > 0),
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  package_id text,
  gate_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('not_started', 'in_progress', 'completed', 'not_applicable')
  ),
  stage_id text NOT NULL,
  scope_level text NOT NULL CHECK (scope_level IN ('project', 'package')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, gate_id),
  UNIQUE (gate_id, sequence),
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id)
    ON DELETE CASCADE,
  FOREIGN KEY (gate_id, project_id, scope_level)
    REFERENCES gate(id, project_id, scope_level)
    ON DELETE CASCADE,
  FOREIGN KEY (gate_id, package_id)
    REFERENCES gate(id, package_id)
    ON DELETE CASCADE,
  CHECK (
    (scope_level = 'project' AND package_id IS NULL)
    OR (scope_level = 'package' AND package_id IS NOT NULL)
  )
);

CREATE INDEX deliverable_project_id_idx ON deliverable(project_id);
CREATE INDEX deliverable_package_id_idx ON deliverable(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX deliverable_gate_id_idx ON deliverable(gate_id);

CREATE TABLE deliverable_criterion (
  deliverable_id text NOT NULL,
  criterion_id text NOT NULL,
  gate_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (deliverable_id, criterion_id),
  UNIQUE (deliverable_id, sequence),
  FOREIGN KEY (deliverable_id, gate_id)
    REFERENCES deliverable(id, gate_id)
    ON DELETE CASCADE,
  FOREIGN KEY (criterion_id, gate_id)
    REFERENCES gate_criterion(id, gate_id)
    ON DELETE RESTRICT
);

CREATE INDEX deliverable_criterion_criterion_id_idx ON deliverable_criterion(criterion_id);

CREATE TABLE project_action_sequence (
  project_id text PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  next_sequence integer NOT NULL CHECK (next_sequence > 0)
);

CREATE TABLE project_action (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  description text NOT NULL CHECK (btrim(description) <> ''),
  assignee text NOT NULL CHECK (btrim(assignee) <> ''),
  due_date date,
  status text NOT NULL CHECK (status IN ('new', 'in_progress', 'finished', 'closed')),
  priority text CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'critical')),
  governance_tier_id text,
  gate_id text,
  source text NOT NULL CHECK (
    source IN ('manual', 'gate', 'meeting', 'risk', 'issue', 'change_moc', 'decision')
  ),
  package_association_locked boolean NOT NULL,
  logged_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  logged_by_display_name text NOT NULL CHECK (btrim(logged_by_display_name) <> ''),
  date_logged timestamptz NOT NULL,
  closing_date timestamptz,
  last_updated timestamptz NOT NULL,
  UNIQUE (project_id, sequence),
  UNIQUE (id, project_id),
  FOREIGN KEY (governance_tier_id, project_id)
    REFERENCES governance_tier(id, project_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (gate_id, project_id)
    REFERENCES gate(id, project_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX project_action_project_id_idx ON project_action(project_id);
CREATE INDEX project_action_governance_tier_id_idx
  ON project_action(governance_tier_id) WHERE governance_tier_id IS NOT NULL;
CREATE INDEX project_action_gate_id_idx ON project_action(gate_id) WHERE gate_id IS NOT NULL;

CREATE TABLE project_action_package (
  action_id text NOT NULL,
  package_id text NOT NULL,
  project_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (action_id, package_id),
  UNIQUE (action_id, sequence),
  FOREIGN KEY (action_id, project_id)
    REFERENCES project_action(id, project_id)
    ON DELETE CASCADE,
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id)
    ON DELETE RESTRICT
);

CREATE INDEX project_action_package_package_id_idx ON project_action_package(package_id);

CREATE TABLE project_action_update (
  id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES project_action(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  occurred_at timestamptz NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  actor_display_name text NOT NULL CHECK (btrim(actor_display_name) <> ''),
  kind text NOT NULL CHECK (kind IN ('comment', 'change')),
  text text NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  UNIQUE (action_id, sequence)
);

CREATE INDEX project_action_update_action_id_idx ON project_action_update(action_id);

CREATE TABLE action_gate_decision_reference (
  id text PRIMARY KEY,
  action_id text NOT NULL,
  gate_id text NOT NULL,
  project_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  decision text NOT NULL CHECK (
    decision IN ('approved', 'approved_with_actions', 'rejected_rework')
  ),
  recorded_at timestamptz NOT NULL,
  UNIQUE (action_id, sequence),
  FOREIGN KEY (action_id, project_id)
    REFERENCES project_action(id, project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (gate_id, project_id)
    REFERENCES gate(id, project_id)
    ON DELETE RESTRICT
);

CREATE INDEX action_gate_decision_reference_action_id_idx
  ON action_gate_decision_reference(action_id);
CREATE INDEX action_gate_decision_reference_gate_id_idx
  ON action_gate_decision_reference(gate_id);

CREATE TABLE gate_review_cycle (
  id text PRIMARY KEY,
  gate_id text NOT NULL REFERENCES gate(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  previous_cycle_id text,
  project_snapshot jsonb NOT NULL CHECK (jsonb_typeof(project_snapshot) = 'object'),
  package_snapshot jsonb CHECK (
    package_snapshot IS NULL OR jsonb_typeof(package_snapshot) = 'object'
  ),
  gate_snapshot jsonb NOT NULL CHECK (jsonb_typeof(gate_snapshot) = 'object'),
  status text NOT NULL CHECK (
    status IN (
      'awaiting_approval',
      'withdrawn',
      'returned_for_rework',
      'approved',
      'approved_with_actions'
    )
  ),
  submitted_at timestamptz NOT NULL,
  submitted_by jsonb NOT NULL CHECK (jsonb_typeof(submitted_by) = 'object'),
  submitted_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decision text CHECK (decision IS NULL OR decision IN ('approved', 'approved_with_actions')),
  decision_comments text NOT NULL,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by jsonb CHECK (withdrawn_by IS NULL OR jsonb_typeof(withdrawn_by) = 'object'),
  withdrawn_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  withdrawal_reason text,
  frozen_evidence jsonb NOT NULL CHECK (jsonb_typeof(frozen_evidence) = 'object'),
  UNIQUE (id, gate_id),
  UNIQUE (gate_id, cycle_number),
  FOREIGN KEY (previous_cycle_id, gate_id)
    REFERENCES gate_review_cycle(id, gate_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX gate_review_cycle_gate_id_idx ON gate_review_cycle(gate_id);
CREATE INDEX gate_review_cycle_status_idx ON gate_review_cycle(status);

CREATE TABLE gate_review_cycle_approver (
  review_cycle_id text NOT NULL REFERENCES gate_review_cycle(id) ON DELETE RESTRICT,
  gate_approver_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  name text NOT NULL CHECK (btrim(name) <> ''),
  email text NOT NULL CHECK (btrim(email) <> ''),
  role_function text NOT NULL CHECK (btrim(role_function) <> ''),
  approval_role text NOT NULL CHECK (btrim(approval_role) <> ''),
  approval_level integer NOT NULL CHECK (approval_level > 0),
  assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  invitation_activated_at timestamptz,
  PRIMARY KEY (review_cycle_id, gate_approver_id),
  UNIQUE (review_cycle_id, sequence)
);

CREATE INDEX gate_review_cycle_approver_user_id_idx
  ON gate_review_cycle_approver(assigned_user_id) WHERE assigned_user_id IS NOT NULL;

CREATE TABLE gate_review_response (
  review_cycle_id text NOT NULL,
  gate_approver_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'returned_for_rework')),
  responded_at timestamptz NOT NULL,
  responded_by jsonb NOT NULL CHECK (jsonb_typeof(responded_by) = 'object'),
  responded_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  comment text NOT NULL,
  PRIMARY KEY (review_cycle_id, gate_approver_id),
  FOREIGN KEY (review_cycle_id, gate_approver_id)
    REFERENCES gate_review_cycle_approver(review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT
);

CREATE TABLE gate_review_invitation_attempt (
  id text PRIMARY KEY,
  review_cycle_id text NOT NULL,
  gate_approver_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  provider text NOT NULL CHECK (btrim(provider) <> ''),
  status text NOT NULL CHECK (status IN ('dispatching', 'sent', 'failed', 'indeterminate')),
  attempted_at timestamptz NOT NULL,
  completed_at timestamptz,
  provider_message_id text,
  error_code text,
  error_message text,
  UNIQUE (review_cycle_id, gate_approver_id, sequence),
  FOREIGN KEY (review_cycle_id, gate_approver_id)
    REFERENCES gate_review_cycle_approver(review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT,
  CHECK (
    (error_code IS NULL AND error_message IS NULL)
    OR (error_code IS NOT NULL AND error_message IS NOT NULL)
  )
);

CREATE INDEX gate_review_invitation_attempt_approver_idx
  ON gate_review_invitation_attempt(review_cycle_id, gate_approver_id);

CREATE TABLE gate_review_rework_action (
  review_cycle_id text NOT NULL REFERENCES gate_review_cycle(id) ON DELETE RESTRICT,
  action_id text NOT NULL REFERENCES project_action(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (review_cycle_id, action_id),
  UNIQUE (review_cycle_id, sequence)
);

CREATE INDEX gate_review_rework_action_action_id_idx
  ON gate_review_rework_action(action_id);

CREATE TABLE operational_import (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  migration_version integer NOT NULL CHECK (migration_version > 0),
  source_commit text NOT NULL,
  source_worktree_dirty boolean NOT NULL,
  source_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_manifest) = 'object'),
  projection_manifest jsonb NOT NULL CHECK (jsonb_typeof(projection_manifest) = 'object'),
  owner_mapping_applied boolean NOT NULL,
  logical_fingerprint text NOT NULL CHECK (logical_fingerprint ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  result text NOT NULL CHECK (result = 'pass')
);

CREATE FUNCTION protect_gate_review_cycle_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gate Review cycles are retained as historical records.';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.gate_id IS DISTINCT FROM NEW.gate_id
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
    OR OLD.cycle_number IS DISTINCT FROM NEW.cycle_number
    OR OLD.previous_cycle_id IS DISTINCT FROM NEW.previous_cycle_id
    OR OLD.project_snapshot IS DISTINCT FROM NEW.project_snapshot
    OR OLD.package_snapshot IS DISTINCT FROM NEW.package_snapshot
    OR OLD.gate_snapshot IS DISTINCT FROM NEW.gate_snapshot
    OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at
    OR OLD.submitted_by IS DISTINCT FROM NEW.submitted_by
    OR OLD.frozen_evidence IS DISTINCT FROM NEW.frozen_evidence
  THEN
    RAISE EXCEPTION 'Frozen Gate Review evidence and identity fields are immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_cycle_history_guard
BEFORE UPDATE OR DELETE ON gate_review_cycle
FOR EACH ROW EXECUTE FUNCTION protect_gate_review_cycle_history();

CREATE FUNCTION protect_gate_review_approver_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gate Review Approver snapshots are retained as historical records.';
  END IF;

  IF OLD.review_cycle_id IS DISTINCT FROM NEW.review_cycle_id
    OR OLD.gate_approver_id IS DISTINCT FROM NEW.gate_approver_id
    OR OLD.sequence IS DISTINCT FROM NEW.sequence
    OR OLD.name IS DISTINCT FROM NEW.name
    OR OLD.email IS DISTINCT FROM NEW.email
    OR OLD.role_function IS DISTINCT FROM NEW.role_function
    OR OLD.approval_role IS DISTINCT FROM NEW.approval_role
    OR OLD.approval_level IS DISTINCT FROM NEW.approval_level
  THEN
    RAISE EXCEPTION 'Frozen Gate Review Approver snapshots are immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_approver_snapshot_guard
BEFORE UPDATE OR DELETE ON gate_review_cycle_approver
FOR EACH ROW EXECUTE FUNCTION protect_gate_review_approver_snapshot();

CREATE FUNCTION reject_historical_record_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable.', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER gate_review_response_history_guard
BEFORE UPDATE OR DELETE ON gate_review_response
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();

CREATE TRIGGER action_gate_decision_reference_history_guard
BEFORE UPDATE OR DELETE ON action_gate_decision_reference
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();
