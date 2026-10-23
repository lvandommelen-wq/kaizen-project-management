WITH eligible_gates AS (
  SELECT
    gate.id AS gate_id,
    gate.project_id,
    gate.package_id,
    coalesce((
      SELECT max(deliverable.sequence)
      FROM deliverable
      WHERE deliverable.gate_id = gate.id
    ), 0) + 1 AS sequence
  FROM gate
  WHERE gate.scope_level = 'package'
    AND gate.stage_id = 'definition'
    AND gate.status <> 'submitted_for_approval'
    AND NOT EXISTS (
      SELECT 1
      FROM gate_review_cycle AS cycle
      WHERE cycle.gate_id = gate.id
        AND cycle.status = 'awaiting_approval'
    )
)
INSERT INTO deliverable (
  id, template_id, template_version, project_id, package_id, gate_id, sequence,
  title, description, status, stage_id, scope_level, created_at, updated_at,
  applicability, applicability_origin, applicability_locked
)
SELECT
  eligible_gates.gate_id || ':deliverable:package_stage_gate_applicability_matrix',
  'package_stage_gate_applicability_matrix',
  5,
  eligible_gates.project_id,
  eligible_gates.package_id,
  eligible_gates.gate_id,
  eligible_gates.sequence,
  'Package Stage-Gate Deliverable Applicability Matrix',
  'Generated from the structured Package applicability configuration and frozen with the Package Definition Complete Review Cycle.',
  'not_started',
  'definition',
  'package',
  now(),
  now(),
  'applicable',
  'template',
  true
FROM eligible_gates
ON CONFLICT DO NOTHING;

UPDATE gate
SET template_version = greatest(template_version, 5)
WHERE scope_level = 'package'
  AND stage_id = 'definition'
  AND status <> 'submitted_for_approval'
  AND NOT EXISTS (
    SELECT 1
    FROM gate_review_cycle AS cycle
    WHERE cycle.gate_id = gate.id
      AND cycle.status = 'awaiting_approval'
  );
