ALTER TABLE governance_tier
  DROP CONSTRAINT governance_tier_project_id_sequence_key;

ALTER TABLE governance_tier
  ADD CONSTRAINT governance_tier_project_id_sequence_key
  UNIQUE (project_id, sequence)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE UNIQUE INDEX deliverable_gate_template_id_idx
  ON deliverable(gate_id, template_id)
  WHERE template_id IS NOT NULL;

CREATE UNIQUE INDEX gate_review_cycle_one_active_per_gate_idx
  ON gate_review_cycle(gate_id)
  WHERE status = 'awaiting_approval';

ALTER TABLE gate_review_cycle
  ADD CONSTRAINT gate_review_cycle_state_check CHECK (
    (
      status = 'awaiting_approval'
      AND decision IS NULL
      AND completed_at IS NULL
      AND withdrawn_at IS NULL
      AND withdrawn_by IS NULL
      AND withdrawn_by_user_id IS NULL
      AND withdrawal_reason IS NULL
    )
    OR (
      status = 'withdrawn'
      AND decision IS NULL
      AND completed_at IS NOT NULL
      AND withdrawn_at IS NOT NULL
      AND withdrawn_at IS NOT DISTINCT FROM completed_at
      AND withdrawn_by IS NOT NULL
    )
    OR (
      status = 'returned_for_rework'
      AND decision IS NULL
      AND completed_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND withdrawn_by IS NULL
      AND withdrawn_by_user_id IS NULL
      AND withdrawal_reason IS NULL
    )
    OR (
      status IN ('approved', 'approved_with_actions')
      AND decision IS NOT DISTINCT FROM status
      AND completed_at IS NOT NULL
      AND withdrawn_at IS NULL
      AND withdrawn_by IS NULL
      AND withdrawn_by_user_id IS NULL
      AND withdrawal_reason IS NULL
    )
  );

CREATE OR REPLACE FUNCTION protect_gate_review_cycle_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gate Review cycles are retained as historical records.';
  END IF;

  IF OLD.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'Completed Gate Review cycles are immutable.';
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
    OR OLD.submitted_by_user_id IS DISTINCT FROM NEW.submitted_by_user_id
    OR OLD.frozen_evidence IS DISTINCT FROM NEW.frozen_evidence
  THEN
    RAISE EXCEPTION 'Frozen Gate Review evidence and identity fields are immutable.';
  END IF;

  IF NEW.status NOT IN (
    'awaiting_approval',
    'withdrawn',
    'returned_for_rework',
    'approved',
    'approved_with_actions'
  ) THEN
    RAISE EXCEPTION 'Invalid Gate Review cycle transition.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_gate_review_approver_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_status text;
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

  IF OLD.assigned_user_id IS NOT DISTINCT FROM NEW.assigned_user_id
    AND OLD.invitation_activated_at IS NOT DISTINCT FROM NEW.invitation_activated_at
  THEN
    RETURN NEW;
  END IF;

  SELECT status
  INTO cycle_status
  FROM gate_review_cycle
  WHERE id = OLD.review_cycle_id;

  IF cycle_status IS DISTINCT FROM 'awaiting_approval' THEN
    RAISE EXCEPTION 'Gate Review Approver assignment and activation require an active Review Cycle.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM gate_review_response
    WHERE review_cycle_id = OLD.review_cycle_id
      AND gate_approver_id = OLD.gate_approver_id
  ) THEN
    RAISE EXCEPTION 'A responding Gate Review Approver can no longer be assigned or activated.';
  END IF;

  IF OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id
    AND (OLD.assigned_user_id IS NOT NULL OR NEW.assigned_user_id IS NULL)
  THEN
    RAISE EXCEPTION 'Gate Review Approver assignment may only change from NULL to a user.';
  END IF;

  IF OLD.invitation_activated_at IS DISTINCT FROM NEW.invitation_activated_at
    AND (OLD.invitation_activated_at IS NOT NULL OR NEW.invitation_activated_at IS NULL)
  THEN
    RAISE EXCEPTION 'Gate Review Approver activation may only change from NULL to a timestamp.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE INDEX gate_review_cycle_approver_activation_idx
  ON gate_review_cycle_approver(review_cycle_id, approval_level, sequence)
  WHERE invitation_activated_at IS NULL;

ALTER TABLE gate_review_invitation_attempt
  ADD COLUMN claim_token text,
  ADD COLUMN claim_expires_at timestamptz;

ALTER TABLE gate_review_invitation_attempt
  DROP CONSTRAINT gate_review_invitation_attempt_result_check;

ALTER TABLE gate_review_invitation_attempt
  ADD CONSTRAINT gate_review_invitation_attempt_result_check CHECK (
    (
      status = 'dispatching'
      AND completed_at IS NULL
      AND provider_message_id IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND claim_token IS NOT NULL
      AND btrim(claim_token) <> ''
      AND claim_expires_at IS NOT NULL
      AND claim_expires_at > attempted_at
    )
    OR (
      status = 'sent'
      AND completed_at IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND claim_token IS NULL
      AND claim_expires_at IS NULL
    )
    OR (
      status IN ('failed', 'indeterminate')
      AND completed_at IS NOT NULL
      AND provider_message_id IS NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
      AND claim_token IS NULL
      AND claim_expires_at IS NULL
    )
  );

CREATE UNIQUE INDEX gate_review_invitation_attempt_one_dispatching_idx
  ON gate_review_invitation_attempt(review_cycle_id, gate_approver_id)
  WHERE status = 'dispatching';

CREATE UNIQUE INDEX gate_review_invitation_attempt_claim_token_idx
  ON gate_review_invitation_attempt(claim_token)
  WHERE claim_token IS NOT NULL;

CREATE UNIQUE INDEX gate_review_invitation_attempt_provider_message_idx
  ON gate_review_invitation_attempt(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX gate_review_invitation_attempt_claim_expiry_idx
  ON gate_review_invitation_attempt(claim_expires_at)
  WHERE status = 'dispatching';

CREATE OR REPLACE FUNCTION protect_gate_review_invitation_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'dispatching' THEN
      PERFORM 1
      FROM gate_review_cycle_approver
      WHERE review_cycle_id = NEW.review_cycle_id
        AND gate_approver_id = NEW.gate_approver_id
      FOR UPDATE;

      IF EXISTS (
        SELECT 1
        FROM gate_review_invitation_attempt
        WHERE review_cycle_id = NEW.review_cycle_id
          AND gate_approver_id = NEW.gate_approver_id
          AND status IN ('dispatching', 'sent', 'indeterminate')
      ) THEN
        RAISE EXCEPTION 'Only a failed Gate Review invitation attempt may be retried.';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gate Review invitation attempts are retained as historical records.';
  END IF;

  IF OLD.status <> 'dispatching' THEN
    RAISE EXCEPTION 'Completed Gate Review invitation attempts are immutable.';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.review_cycle_id IS DISTINCT FROM NEW.review_cycle_id
    OR OLD.gate_approver_id IS DISTINCT FROM NEW.gate_approver_id
    OR OLD.sequence IS DISTINCT FROM NEW.sequence
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.provider IS DISTINCT FROM NEW.provider
    OR OLD.attempted_at IS DISTINCT FROM NEW.attempted_at
  THEN
    RAISE EXCEPTION 'Gate Review invitation attempt identity fields are immutable.';
  END IF;

  PERFORM 1
  FROM gate_review_cycle_approver
  WHERE review_cycle_id = OLD.review_cycle_id
    AND gate_approver_id = OLD.gate_approver_id
  FOR UPDATE;

  IF NEW.status = 'dispatching' THEN
    IF OLD.claim_expires_at IS NULL OR OLD.claim_expires_at > clock_timestamp() THEN
      RAISE EXCEPTION 'An active Gate Review invitation claim cannot be replaced.';
    END IF;

    IF OLD.claim_token IS NOT DISTINCT FROM NEW.claim_token
      OR NEW.claim_expires_at <= clock_timestamp()
    THEN
      RAISE EXCEPTION 'A recovered Gate Review invitation claim requires a new token and future expiry.';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('sent', 'failed', 'indeterminate') THEN
    RAISE EXCEPTION 'Invalid Gate Review invitation attempt transition.';
  END IF;

  IF OLD.claim_token IS NULL
    OR OLD.claim_expires_at IS NULL
    OR OLD.claim_expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION 'An expired Gate Review invitation claim must be recovered before completion.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER gate_review_invitation_attempt_history_guard
  ON gate_review_invitation_attempt;

CREATE TRIGGER gate_review_invitation_attempt_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON gate_review_invitation_attempt
FOR EACH ROW EXECUTE FUNCTION protect_gate_review_invitation_attempt_history();

ALTER TABLE project_action
  ADD COLUMN lock_version bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT project_action_lock_version_check CHECK (lock_version > 0),
  ADD CONSTRAINT project_action_closing_date_check CHECK (
    (status = 'closed') = (closing_date IS NOT NULL)
  );

CREATE INDEX project_action_open_due_date_idx
  ON project_action(project_id, due_date)
  WHERE status <> 'closed';

CREATE FUNCTION protect_project_action_update_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    OR EXISTS (
      SELECT 1 FROM project_action WHERE id = OLD.action_id
    )
  THEN
    RAISE EXCEPTION 'project_action_update records are immutable.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER project_action_update_history_guard
BEFORE UPDATE OR DELETE ON project_action_update
FOR EACH ROW EXECUTE FUNCTION protect_project_action_update_history();

CREATE TRIGGER operational_import_history_guard
BEFORE UPDATE OR DELETE ON operational_import
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();

ALTER TABLE action_gate_decision_reference
  ADD COLUMN review_cycle_id text,
  ADD CONSTRAINT action_gate_decision_reference_review_cycle_gate_fkey
    FOREIGN KEY (review_cycle_id, gate_id)
    REFERENCES gate_review_cycle(id, gate_id)
    ON DELETE RESTRICT;

CREATE INDEX action_gate_decision_reference_review_cycle_id_idx
  ON action_gate_decision_reference(review_cycle_id)
  WHERE review_cycle_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM gate_review_rework_action AS rework
    JOIN gate_review_cycle AS cycle
      ON cycle.id = rework.review_cycle_id
    JOIN gate
      ON gate.id = cycle.gate_id
    JOIN project_action AS action
      ON action.id = rework.action_id
    WHERE gate.project_id IS DISTINCT FROM action.project_id
  ) THEN
    RAISE EXCEPTION 'Existing Gate Review rework Actions cross Project boundaries.';
  END IF;
END;
$$;

CREATE FUNCTION enforce_gate_review_rework_action_project_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_project_id text;
  action_project_id text;
BEGIN
  SELECT gate.project_id
  INTO review_project_id
  FROM gate_review_cycle AS cycle
  JOIN gate
    ON gate.id = cycle.gate_id
  WHERE cycle.id = NEW.review_cycle_id;

  SELECT project_id
  INTO action_project_id
  FROM project_action
  WHERE id = NEW.action_id;

  IF review_project_id IS NULL
    OR action_project_id IS NULL
    OR review_project_id IS DISTINCT FROM action_project_id
  THEN
    RAISE EXCEPTION 'Gate Review rework Actions must belong to the Review Cycle Project.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_rework_action_project_scope_guard
BEFORE INSERT OR UPDATE ON gate_review_rework_action
FOR EACH ROW EXECUTE FUNCTION enforce_gate_review_rework_action_project_scope();

CREATE INDEX project_active_updated_at_idx
  ON project(updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX project_package_active_project_code_idx
  ON project_package(project_id, package_code)
  WHERE archived_at IS NULL;

CREATE INDEX gate_review_cycle_gate_status_idx
  ON gate_review_cycle(gate_id, status, cycle_number DESC);
