-- Restore completion states that the previous applicability workflow reset when
-- an item became Not Applicable. The immutable history remains unchanged.
ALTER TABLE gate_criterion
  DROP CONSTRAINT gate_criterion_applicability_state_check;

ALTER TABLE deliverable
  DROP CONSTRAINT deliverable_applicability_state_check;

WITH latest_not_applicable_change AS (
  SELECT DISTINCT ON (item_id)
    item_id,
    previous_completion_status
  FROM applicability_change
  WHERE item_type = 'criterion'
    AND applicability = 'not_applicable'
    AND previous_completion_status IN ('pending', 'completed')
  ORDER BY item_id, changed_at DESC, id DESC
)
UPDATE gate_criterion AS criterion
SET status = change.previous_completion_status
FROM latest_not_applicable_change AS change
WHERE criterion.id = change.item_id
  AND criterion.applicability = 'not_applicable';

WITH latest_not_applicable_change AS (
  SELECT DISTINCT ON (item_id)
    item_id,
    previous_completion_status
  FROM applicability_change
  WHERE item_type = 'deliverable'
    AND applicability = 'not_applicable'
    AND previous_completion_status IN ('not_started', 'in_progress', 'completed')
  ORDER BY item_id, changed_at DESC, id DESC
)
UPDATE deliverable
SET status = change.previous_completion_status
FROM latest_not_applicable_change AS change
WHERE deliverable.id = change.item_id
  AND deliverable.applicability = 'not_applicable';

-- The active workflow is binary. Completion status remains independent and is
-- deliberately not changed during the TBD-to-Applicable conversion.
UPDATE gate_criterion
SET applicability = 'applicable'
WHERE applicability = 'to_be_determined';

UPDATE deliverable
SET applicability = 'applicable'
WHERE applicability = 'to_be_determined';

ALTER TABLE gate_criterion
  ALTER COLUMN applicability SET DEFAULT 'applicable',
  DROP CONSTRAINT gate_criterion_applicability_check,
  ADD CONSTRAINT gate_criterion_applicability_check CHECK (
    applicability IN ('applicable', 'not_applicable')
  ),
  ADD CONSTRAINT gate_criterion_applicability_state_check CHECK (
    (applicability = 'not_applicable' OR applicability_justification IS NULL)
    AND (
      applicability <> 'not_applicable'
      OR applicability_origin = 'legacy'
      OR coalesce(btrim(applicability_justification), '') <> ''
    )
    AND (NOT applicability_locked OR applicability = 'applicable')
    AND (
      applicability_origin <> 'user'
      OR (
        applicability_decided_at IS NOT NULL
        AND coalesce(btrim(applicability_decided_by_display_name), '') <> ''
      )
    )
  );

-- Migration 010 attached this function to both OTP challenges and sessions.
-- Keep its authority checks unchanged, but only access otp_challenge_id inside
-- the session branch because challenge rows do not contain that column.
CREATE OR REPLACE FUNCTION enforce_gate_review_otp_authority()
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

  IF TG_TABLE_NAME = 'gate_review_session' THEN
    IF NOT EXISTS (
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
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE deliverable
  ALTER COLUMN applicability SET DEFAULT 'applicable',
  DROP CONSTRAINT deliverable_applicability_check,
  ADD CONSTRAINT deliverable_applicability_check CHECK (
    applicability IN ('applicable', 'not_applicable')
  ),
  ADD CONSTRAINT deliverable_applicability_state_check CHECK (
    (applicability = 'not_applicable' OR applicability_justification IS NULL)
    AND (
      applicability <> 'not_applicable'
      OR applicability_origin = 'legacy'
      OR coalesce(btrim(applicability_justification), '') <> ''
    )
    AND (NOT applicability_locked OR applicability = 'applicable')
    AND (
      applicability_origin <> 'user'
      OR (
        applicability_decided_at IS NOT NULL
        AND coalesce(btrim(applicability_decided_by_display_name), '') <> ''
      )
    )
  );
