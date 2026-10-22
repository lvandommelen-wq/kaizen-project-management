ALTER TABLE gate_approver
  ADD COLUMN assigned_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN expected_provider_tenant_id text,
  ADD COLUMN expected_provider_object_id text,
  ADD CONSTRAINT gate_approver_identity_target_check CHECK (
    (expected_provider_tenant_id IS NULL AND expected_provider_object_id IS NULL AND assigned_user_id IS NULL)
    OR (
      expected_provider_tenant_id IS NOT NULL
      AND expected_provider_object_id IS NOT NULL
      AND expected_provider_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND expected_provider_object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  );

CREATE INDEX gate_approver_assigned_user_id_idx
  ON gate_approver(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

ALTER TABLE gate_review_cycle_approver
  ADD COLUMN expected_provider_tenant_id text,
  ADD COLUMN expected_provider_object_id text,
  ADD CONSTRAINT gate_review_cycle_approver_identity_target_check CHECK (
    (expected_provider_tenant_id IS NULL AND expected_provider_object_id IS NULL AND assigned_user_id IS NULL)
    OR (
      expected_provider_tenant_id IS NOT NULL
      AND expected_provider_object_id IS NOT NULL
      AND expected_provider_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND expected_provider_object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  );

CREATE UNIQUE INDEX gate_review_cycle_approver_identity_idx
  ON gate_review_cycle_approver(
    review_cycle_id,
    expected_provider_tenant_id,
    expected_provider_object_id
  )
  WHERE expected_provider_tenant_id IS NOT NULL
    AND expected_provider_object_id IS NOT NULL;

ALTER TABLE gate_review_response
  ADD COLUMN responder_provider_tenant_id text,
  ADD COLUMN responder_provider_object_id text,
  ADD CONSTRAINT gate_review_response_identity_check CHECK (
    (responder_provider_tenant_id IS NULL AND responder_provider_object_id IS NULL)
    OR (
      responder_provider_tenant_id IS NOT NULL
      AND responder_provider_object_id IS NOT NULL
      AND responder_provider_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND responder_provider_object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  );

CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id uuid NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  actor_provider_tenant_id text,
  actor_provider_object_id text,
  actor_access_class text CHECK (
    actor_access_class IS NULL OR actor_access_class IN ('internal', 'external_reviewer')
  ),
  project_id text,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  resource_type text NOT NULL CHECK (btrim(resource_type) <> ''),
  resource_id text NOT NULL CHECK (btrim(resource_id) <> ''),
  change_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(change_summary) = 'object'
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
  ),
  CHECK (
    (actor_provider_tenant_id IS NULL AND actor_provider_object_id IS NULL)
    OR (
      actor_provider_tenant_id IS NOT NULL
      AND actor_provider_object_id IS NOT NULL
      AND actor_provider_tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND actor_provider_object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  )
);

CREATE INDEX audit_event_project_occurred_at_idx
  ON audit_event(project_id, occurred_at DESC, id);
CREATE INDEX audit_event_actor_user_id_idx
  ON audit_event(actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX audit_event_resource_idx
  ON audit_event(resource_type, resource_id, occurred_at DESC);

CREATE FUNCTION reject_audit_event_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only and cannot be changed.';
END;
$$;

CREATE TRIGGER audit_event_history_guard
BEFORE UPDATE OR DELETE ON audit_event
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_change();

CREATE FUNCTION enforce_project_member_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app_user
    WHERE id = NEW.user_id
      AND status = 'active'
      AND access_class = 'internal'
  ) THEN
    RAISE EXCEPTION 'Project members must be active internal users.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_membership_internal_user_guard
BEFORE INSERT OR UPDATE OF user_id ON project_membership
FOR EACH ROW EXECUTE FUNCTION enforce_project_member_identity();

CREATE FUNCTION enforce_project_active_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_project_id text;
BEGIN
  IF TG_TABLE_NAME = 'project_membership' THEN
    affected_project_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.project_id
      ELSE NEW.project_id
    END;
  END IF;

  IF TG_TABLE_NAME = 'project_membership' THEN
    IF EXISTS (SELECT 1 FROM project WHERE id = affected_project_id)
      AND NOT EXISTS (
        SELECT 1
        FROM project_membership AS membership
        JOIN app_user ON app_user.id = membership.user_id
        WHERE membership.project_id = affected_project_id
          AND membership.role = 'owner'
          AND app_user.status = 'active'
          AND app_user.access_class = 'internal'
      )
    THEN
      RAISE EXCEPTION 'A Project must retain at least one active Owner.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM project_membership AS affected
      WHERE affected.user_id = NEW.id
        AND affected.role = 'owner'
        AND NOT EXISTS (
          SELECT 1
          FROM project_membership AS membership
          JOIN app_user ON app_user.id = membership.user_id
          WHERE membership.project_id = affected.project_id
            AND membership.role = 'owner'
            AND app_user.status = 'active'
            AND app_user.access_class = 'internal'
        )
    ) THEN
      RAISE EXCEPTION 'Disabling this User would leave a Project without an active Owner.';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER project_membership_active_owner_guard
AFTER INSERT OR UPDATE OR DELETE ON project_membership
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_project_active_owner();

CREATE CONSTRAINT TRIGGER app_user_active_owner_guard
AFTER UPDATE ON app_user
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_project_active_owner();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project
    WHERE project.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM project_membership AS membership
        JOIN app_user ON app_user.id = membership.user_id
        WHERE membership.project_id = project.id
          AND membership.role = 'owner'
          AND app_user.status = 'active'
          AND app_user.access_class = 'internal'
      )
  ) THEN
    RAISE EXCEPTION 'Migration 007 requires every active Project to have an active internal Owner.';
  END IF;
END;
$$;

CREATE FUNCTION enforce_gate_approver_identity_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app_user
    JOIN user_identity ON user_identity.user_id = app_user.id
    WHERE app_user.id = NEW.assigned_user_id
      AND app_user.status = 'active'
      AND user_identity.provider = 'microsoft'
      AND user_identity.provider_tenant_id = NEW.expected_provider_tenant_id
      AND user_identity.provider_object_id = NEW.expected_provider_object_id
  ) THEN
    RAISE EXCEPTION 'The assigned Gate Approver identity does not match the User identity.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_approver_identity_assignment_guard
BEFORE INSERT OR UPDATE OF assigned_user_id, expected_provider_tenant_id, expected_provider_object_id
ON gate_approver
FOR EACH ROW EXECUTE FUNCTION enforce_gate_approver_identity_assignment();

CREATE TRIGGER gate_review_cycle_approver_identity_assignment_guard
BEFORE INSERT OR UPDATE OF assigned_user_id, expected_provider_tenant_id, expected_provider_object_id
ON gate_review_cycle_approver
FOR EACH ROW EXECUTE FUNCTION enforce_gate_approver_identity_assignment();

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
    OR OLD.expected_provider_tenant_id IS DISTINCT FROM NEW.expected_provider_tenant_id
    OR OLD.expected_provider_object_id IS DISTINCT FROM NEW.expected_provider_object_id
  THEN
    RAISE EXCEPTION 'Frozen Gate Review Approver snapshots are immutable.';
  END IF;

  IF OLD.assigned_user_id IS NOT DISTINCT FROM NEW.assigned_user_id
    AND OLD.invitation_activated_at IS NOT DISTINCT FROM NEW.invitation_activated_at
  THEN
    RETURN NEW;
  END IF;

  SELECT status INTO cycle_status
  FROM gate_review_cycle
  WHERE id = OLD.review_cycle_id;

  IF cycle_status IS DISTINCT FROM 'awaiting_approval' THEN
    RAISE EXCEPTION 'Gate Review Approver assignment and activation require an active Review Cycle.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM gate_review_response
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
