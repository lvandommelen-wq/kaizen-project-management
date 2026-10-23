-- Retire the obsolete Procurement Final TECO default. Technical Evaluation / TECO
-- remains part of the Package Tendering methodology.

DO $$
DECLARE
  unsafe_records text;
BEGIN
  SELECT string_agg(deliverable.id, ', ' ORDER BY deliverable.id)
  INTO unsafe_records
  FROM deliverable
  JOIN gate ON gate.id = deliverable.gate_id
  WHERE deliverable.template_id = 'final_technical_evaluation'
    AND NOT (
      deliverable.scope_level = 'package'
      AND deliverable.package_id IS NOT NULL
      AND deliverable.stage_id = 'procurement'
      AND gate.scope_level = 'package'
      AND gate.stage_id = 'procurement'
      AND gate.status = 'not_submitted'
      AND deliverable.id = gate.id || ':deliverable:final_technical_evaluation'
      AND deliverable.template_version = 2
      AND deliverable.title = 'Final Technical Evaluation / TECO'
      AND btrim(deliverable.description) = ''
      AND deliverable.status = 'not_started'
      AND deliverable.applicability = 'applicable'
      AND deliverable.applicability_justification IS NULL
      AND deliverable.applicability_decided_at IS NULL
      AND deliverable.applicability_decided_by_user_id IS NULL
      AND deliverable.applicability_decided_by_display_name IS NULL
      AND deliverable.applicability_origin IN ('legacy', 'template')
      AND deliverable.applicability_locked = false
      AND NOT EXISTS (
        SELECT 1 FROM deliverable_criterion AS link
        WHERE link.deliverable_id = deliverable.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM applicability_change AS change
        WHERE change.item_id = deliverable.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM audit_event AS event
        WHERE event.resource_id = deliverable.id
           OR event.change_summary::text LIKE '%' || deliverable.id || '%'
           OR event.metadata::text LIKE '%' || deliverable.id || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM gate_review_cycle AS cycle
        WHERE cycle.frozen_evidence::text LIKE '%' || deliverable.id || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM project_action AS action
        WHERE action.description LIKE '%' || deliverable.id || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM project_action_update AS update
        WHERE update.text LIKE '%' || deliverable.id || '%'
           OR update.changes::text LIKE '%' || deliverable.id || '%'
      )
    );

  IF unsafe_records IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 016 stopped because obsolete Procurement TECO records contain protected or unexpected data: %', unsafe_records;
  END IF;
END;
$$;

DELETE FROM deliverable
USING gate
WHERE gate.id = deliverable.gate_id
  AND deliverable.template_id = 'final_technical_evaluation'
  AND deliverable.scope_level = 'package'
  AND deliverable.stage_id = 'procurement'
  AND gate.scope_level = 'package'
  AND gate.stage_id = 'procurement'
  AND gate.status = 'not_submitted';

DO $$
DECLARE
  invalid_packages text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM deliverable
    WHERE template_id = 'final_technical_evaluation'
      AND scope_level = 'package'
      AND stage_id = 'procurement'
  ) THEN
    RAISE EXCEPTION 'Migration 016 did not retire every safe obsolete Procurement TECO default.';
  END IF;

  SELECT string_agg(package.package_code, ', ' ORDER BY package.package_code)
  INTO invalid_packages
  FROM project_package AS package
  LEFT JOIN gate AS procurement_gate
    ON procurement_gate.package_id = package.id
   AND procurement_gate.stage_id = 'procurement'
  LEFT JOIN deliverable AS procurement_default
    ON procurement_default.gate_id = procurement_gate.id
   AND procurement_default.template_id IS NOT NULL
  GROUP BY package.id, package.package_code
  HAVING count(procurement_default.id) <> 4;

  IF invalid_packages IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 016 expected exactly four Procurement defaults for Packages: %', invalid_packages;
  END IF;

  SELECT string_agg(package.package_code, ', ' ORDER BY package.package_code)
  INTO invalid_packages
  FROM project_package AS package
  LEFT JOIN deliverable AS package_default
    ON package_default.package_id = package.id
   AND package_default.scope_level = 'package'
   AND package_default.template_id IS NOT NULL
  GROUP BY package.id, package.package_code
  HAVING count(package_default.id) <> 42;

  IF invalid_packages IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 016 expected exactly 42 Package defaults for Packages: %', invalid_packages;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM deliverable
    WHERE template_id IS NOT NULL
    GROUP BY gate_id, template_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration 016 found duplicate default Deliverables after correction.';
  END IF;
END;
$$;
