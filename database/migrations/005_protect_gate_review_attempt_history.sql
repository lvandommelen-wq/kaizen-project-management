ALTER TABLE gate_review_invitation_attempt
  ADD CONSTRAINT gate_review_invitation_attempt_result_check CHECK (
    (
      status = 'dispatching'
      AND completed_at IS NULL
      AND provider_message_id IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      status = 'sent'
      AND completed_at IS NOT NULL
      AND provider_message_id IS NOT NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      status IN ('failed', 'indeterminate')
      AND completed_at IS NOT NULL
      AND provider_message_id IS NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
    )
  );

CREATE FUNCTION protect_gate_review_invitation_attempt_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
    OR NEW.status NOT IN ('sent', 'failed', 'indeterminate')
  THEN
    RAISE EXCEPTION 'Gate Review invitation attempt identity fields are immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER gate_review_invitation_attempt_history_guard
BEFORE UPDATE OR DELETE ON gate_review_invitation_attempt
FOR EACH ROW EXECUTE FUNCTION protect_gate_review_invitation_attempt_history();

CREATE TRIGGER gate_review_rework_action_history_guard
BEFORE UPDATE OR DELETE ON gate_review_rework_action
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();
