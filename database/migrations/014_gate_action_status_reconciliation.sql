ALTER TABLE action_gate_decision_reference
  ADD COLUMN action_sequence_at_approval integer,
  ADD COLUMN description_at_approval text,
  ADD COLUMN assignee_at_approval text,
  ADD COLUMN due_date_at_approval date,
  ADD COLUMN status_at_approval text;

ALTER TABLE action_gate_decision_reference
  ADD CONSTRAINT action_gate_decision_reference_approval_snapshot_check
  CHECK (
    (
      action_sequence_at_approval IS NULL
      AND description_at_approval IS NULL
      AND assignee_at_approval IS NULL
      AND due_date_at_approval IS NULL
      AND status_at_approval IS NULL
    )
    OR (
      action_sequence_at_approval IS NOT NULL
      AND action_sequence_at_approval > 0
      AND description_at_approval IS NOT NULL
      AND btrim(description_at_approval) <> ''
      AND assignee_at_approval IS NOT NULL
      AND btrim(assignee_at_approval) <> ''
      AND status_at_approval IS NOT NULL
      AND status_at_approval IN ('new', 'in_progress', 'finished', 'closed')
    )
  );

CREATE UNIQUE INDEX action_gate_decision_reference_cycle_action_idx
  ON action_gate_decision_reference(review_cycle_id, action_id)
  WHERE review_cycle_id IS NOT NULL;
