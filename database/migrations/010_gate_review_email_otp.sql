ALTER TABLE gate_review_cycle_approver
  ADD COLUMN authentication_method text,
  ADD COLUMN review_access_id uuid,
  ADD CONSTRAINT gate_review_cycle_approver_authentication_check CHECK (
    (
      authentication_method IS NULL
      AND review_access_id IS NULL
    )
    OR (
      authentication_method = 'email_otp'
      AND review_access_id IS NOT NULL
      AND assigned_user_id IS NULL
      AND expected_provider_tenant_id IS NULL
      AND expected_provider_object_id IS NULL
    )
  ),
  ADD CONSTRAINT gate_review_cycle_approver_review_access_id_key UNIQUE (review_access_id);

CREATE TABLE gate_review_otp_challenge (
  id uuid PRIMARY KEY,
  review_cycle_id text NOT NULL,
  gate_approver_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  code_digest text NOT NULL CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
  delivery_status text NOT NULL CHECK (
    delivery_status IN ('dispatching', 'sent', 'failed', 'indeterminate')
  ),
  delivery_completed_at timestamptz,
  provider_message_id text,
  error_code text,
  error_message text,
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (
    failed_attempt_count BETWEEN 0 AND 5
  ),
  locked_at timestamptz,
  consumed_at timestamptz,
  UNIQUE (review_cycle_id, gate_approver_id, sequence),
  UNIQUE (id, review_cycle_id, gate_approver_id),
  FOREIGN KEY (review_cycle_id, gate_approver_id)
    REFERENCES gate_review_cycle_approver(review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT,
  CHECK (
    (error_code IS NULL AND error_message IS NULL)
    OR (error_code IS NOT NULL AND error_message IS NOT NULL)
  ),
  CHECK (
    (
      delivery_status = 'dispatching'
      AND delivery_completed_at IS NULL
      AND provider_message_id IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      delivery_status = 'sent'
      AND delivery_completed_at IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      delivery_status IN ('failed', 'indeterminate')
      AND delivery_completed_at IS NOT NULL
      AND provider_message_id IS NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
    )
  ),
  CHECK ((locked_at IS NULL) = (failed_attempt_count < 5)),
  CHECK (consumed_at IS NULL OR (
    delivery_status = 'sent'
    AND locked_at IS NULL
  ))
);

CREATE INDEX gate_review_otp_challenge_assignment_requested_idx
  ON gate_review_otp_challenge(review_cycle_id, gate_approver_id, requested_at DESC);

CREATE TABLE gate_review_session (
  id uuid PRIMARY KEY,
  review_cycle_id text NOT NULL,
  gate_approver_id text NOT NULL,
  otp_challenge_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE (id, review_cycle_id, gate_approver_id),
  FOREIGN KEY (review_cycle_id, gate_approver_id)
    REFERENCES gate_review_cycle_approver(review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (otp_challenge_id, review_cycle_id, gate_approver_id)
    REFERENCES gate_review_otp_challenge(id, review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT
);

CREATE INDEX gate_review_session_assignment_expires_idx
  ON gate_review_session(review_cycle_id, gate_approver_id, expires_at DESC);

ALTER TABLE gate_review_response
  ADD COLUMN authentication_method text,
  ADD COLUMN review_session_id uuid REFERENCES gate_review_session(id) ON DELETE RESTRICT,
  ADD CONSTRAINT gate_review_response_authentication_check CHECK (
    (
      authentication_method IS NULL
      AND review_session_id IS NULL
    )
    OR (
      authentication_method = 'email_otp'
      AND review_session_id IS NOT NULL
      AND responded_by_user_id IS NULL
      AND responder_provider_tenant_id IS NULL
      AND responder_provider_object_id IS NULL
    )
  ),
  ADD CONSTRAINT gate_review_response_session_assignment_fk
    FOREIGN KEY (review_session_id, review_cycle_id, gate_approver_id)
    REFERENCES gate_review_session(id, review_cycle_id, gate_approver_id)
    ON DELETE RESTRICT;

CREATE FUNCTION enforce_gate_review_otp_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM gate_review_cycle_approver AS approver
    JOIN gate_review_cycle AS cycle ON cycle.id = approver.review_cycle_id
    WHERE approver.review_cycle_id = NEW.review_cycle_id
      AND approver.gate_approver_id = NEW.gate_approver_id
      AND approver.authentication_method = 'email_otp'
      AND approver.invitation_activated_at IS NOT NULL
      AND cycle.status = 'awaiting_approval'
      AND NOT EXISTS (
        SELECT 1 FROM gate_review_response AS response
        WHERE response.review_cycle_id = approver.review_cycle_id
          AND response.gate_approver_id = approver.gate_approver_id
      )
  ) THEN
    RAISE EXCEPTION 'Email OTP authority requires an active eligible Review Cycle assignment.';
  END IF;

  IF TG_TABLE_NAME = 'gate_review_session' AND NOT EXISTS (
    SELECT 1
    FROM gate_review_otp_challenge AS challenge
    WHERE challenge.id = NEW.otp_challenge_id
      AND challenge.review_cycle_id = NEW.review_cycle_id
      AND challenge.gate_approver_id = NEW.gate_approver_id
      AND challenge.delivery_status = 'sent'
      AND challenge.consumed_at IS NOT NULL
      AND challenge.locked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A Review Cycle session requires a consumed OTP challenge.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_otp_challenge_authority_guard
BEFORE INSERT ON gate_review_otp_challenge
FOR EACH ROW EXECUTE FUNCTION enforce_gate_review_otp_authority();

CREATE TRIGGER gate_review_session_authority_guard
BEFORE INSERT ON gate_review_session
FOR EACH ROW EXECUTE FUNCTION enforce_gate_review_otp_authority();

CREATE FUNCTION protect_gate_review_otp_challenge_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gate Review OTP challenges are retained as historical records.';
  END IF;

  IF OLD.id IS DISTINCT FROM NEW.id
    OR OLD.review_cycle_id IS DISTINCT FROM NEW.review_cycle_id
    OR OLD.gate_approver_id IS DISTINCT FROM NEW.gate_approver_id
    OR OLD.sequence IS DISTINCT FROM NEW.sequence
    OR OLD.code_digest IS DISTINCT FROM NEW.code_digest
    OR OLD.requested_at IS DISTINCT FROM NEW.requested_at
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.failed_attempt_count > NEW.failed_attempt_count
    OR NEW.failed_attempt_count > OLD.failed_attempt_count + 1
    OR (OLD.delivery_status <> 'dispatching' AND OLD.delivery_status IS DISTINCT FROM NEW.delivery_status)
    OR (
      OLD.delivery_status <> 'dispatching'
      AND (
        OLD.delivery_completed_at IS DISTINCT FROM NEW.delivery_completed_at
        OR OLD.provider_message_id IS DISTINCT FROM NEW.provider_message_id
        OR OLD.error_code IS DISTINCT FROM NEW.error_code
        OR OLD.error_message IS DISTINCT FROM NEW.error_message
      )
    )
    OR (OLD.delivery_status = 'dispatching' AND NEW.delivery_status NOT IN ('dispatching', 'sent', 'failed', 'indeterminate'))
    OR (OLD.locked_at IS NOT NULL AND OLD.locked_at IS DISTINCT FROM NEW.locked_at)
    OR (OLD.consumed_at IS NOT NULL AND OLD.consumed_at IS DISTINCT FROM NEW.consumed_at)
  THEN
    RAISE EXCEPTION 'Gate Review OTP challenge history is immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_otp_challenge_history_guard
BEFORE UPDATE OR DELETE ON gate_review_otp_challenge
FOR EACH ROW EXECUTE FUNCTION protect_gate_review_otp_challenge_history();

CREATE TRIGGER gate_review_session_history_guard
BEFORE UPDATE OR DELETE ON gate_review_session
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();

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
    OR OLD.authentication_method IS DISTINCT FROM NEW.authentication_method
    OR OLD.review_access_id IS DISTINCT FROM NEW.review_access_id
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
