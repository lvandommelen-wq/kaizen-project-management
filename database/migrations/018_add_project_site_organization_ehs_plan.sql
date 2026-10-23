-- Add the Project-wide Site Organization & EHS Plan to eligible Project
-- Baseline Approval Gates without changing submitted or approved evidence.

DO $$
DECLARE
  unsafe_records text;
BEGIN
  SELECT string_agg(deliverable.id, ', ' ORDER BY deliverable.id)
  INTO unsafe_records
  FROM deliverable
  WHERE deliverable.template_id = 'project_site_organization_ehs_plan';

  IF unsafe_records IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 found pre-existing Project Site Organization & EHS Plan defaults: %', unsafe_records;
  END IF;

  SELECT string_agg(deliverable.id, ', ' ORDER BY deliverable.id)
  INTO unsafe_records
  FROM gate
  JOIN deliverable
    ON deliverable.id = gate.id || ':deliverable:project_site_organization_ehs_plan'
  WHERE gate.scope_level = 'project'
    AND gate.stage_id = 'definition_design';

  IF unsafe_records IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 found conflicting stable Deliverable IDs: %', unsafe_records;
  END IF;
END;
$$;

CREATE TEMP TABLE methodology_018_target ON COMMIT DROP AS
SELECT gate.id AS gate_id, gate.project_id, project.project_number,
  governance.sequence AS governance_sequence
FROM gate
JOIN project ON project.id = gate.project_id
JOIN deliverable AS governance
  ON governance.gate_id = gate.id
 AND governance.template_id = 'project_governance_escalation_plan'
WHERE gate.scope_level = 'project'
  AND gate.stage_id = 'definition_design'
  AND gate.status IN ('not_submitted', 'returned_for_rework');

DO $$
DECLARE
  unsafe_projects text;
BEGIN
  SELECT string_agg(project.project_number, ', ' ORDER BY project.project_number)
  INTO unsafe_projects
  FROM project
  JOIN gate
    ON gate.project_id = project.id
   AND gate.scope_level = 'project'
   AND gate.stage_id = 'definition_design'
   AND gate.status IN ('not_submitted', 'returned_for_rework')
  LEFT JOIN deliverable AS governance
    ON governance.gate_id = gate.id
   AND governance.template_id = 'project_governance_escalation_plan'
  GROUP BY project.id, project.project_number, gate.id
  HAVING count(governance.id) <> 1;

  IF unsafe_projects IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 expected exactly one Project Governance plan on eligible Baseline Gates for Projects: %', unsafe_projects;
  END IF;

  SELECT string_agg(target.project_number, ', ' ORDER BY target.project_number)
  INTO unsafe_projects
  FROM methodology_018_target AS target
  WHERE (SELECT count(*) FROM deliverable
         WHERE deliverable.gate_id = target.gate_id
           AND deliverable.template_id IS NOT NULL) <> 17
     OR (SELECT coalesce(max(deliverable.sequence), 0) FROM deliverable
         WHERE deliverable.gate_id = target.gate_id) >= 10000
     OR EXISTS (
       SELECT 1 FROM gate_review_cycle
       WHERE gate_review_cycle.gate_id = target.gate_id
         AND gate_review_cycle.status = 'awaiting_approval'
     );

  IF unsafe_projects IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 stopped because eligible Baseline Gates are not in the expected safe state for Projects: %', unsafe_projects;
  END IF;
END;
$$;

-- Move existing sequence values out of the way so the new row can be inserted
-- and all existing relative ordering can be restored without uniqueness conflicts.
UPDATE deliverable
SET sequence = deliverable.sequence + 10000
FROM methodology_018_target AS target
WHERE deliverable.gate_id = target.gate_id;

INSERT INTO deliverable (
  id, template_id, template_version, project_id, package_id, gate_id, sequence,
  title, description, status, stage_id, scope_level, created_at, updated_at,
  applicability, applicability_justification, applicability_decided_at,
  applicability_decided_by_user_id, applicability_decided_by_display_name,
  applicability_origin, applicability_locked
)
SELECT target.gate_id || ':deliverable:project_site_organization_ehs_plan',
  'project_site_organization_ehs_plan', 7, target.project_id, NULL,
  target.gate_id, target.governance_sequence + 20000,
  'Project Site Organization & EHS Plan',
  'Accepted when a proportionate Project-wide plan defines the applicable site organization, access, logistics, storage, traffic management, EHS responsibilities, supervision, escalation, permit-to-work, LOTO and energy isolation, contractor onboarding, risk prevention, SIMOPS, lifting, emergency response, incident reporting, PPE, housekeeping, waste, environmental and construction-site safety coordination requirements for relevant Packages, contractors and subcontractors.',
  'not_started', 'definition_design', 'project', now(), now(), 'applicable',
  NULL, NULL, NULL, NULL, 'template', false
FROM methodology_018_target AS target;

WITH ordered AS (
  SELECT deliverable.id,
    row_number() OVER (
      PARTITION BY deliverable.gate_id
      ORDER BY CASE
        WHEN deliverable.template_id = 'project_site_organization_ehs_plan'
          THEN target.governance_sequence + 0.5
        ELSE deliverable.sequence - 10000
      END,
      deliverable.id
    )::integer AS sequence
  FROM deliverable
  JOIN methodology_018_target AS target ON target.gate_id = deliverable.gate_id
)
UPDATE deliverable
SET sequence = ordered.sequence
FROM ordered
WHERE deliverable.id = ordered.id;

UPDATE gate
SET template_version = 7
FROM methodology_018_target AS target
WHERE gate.id = target.gate_id;

DO $$
DECLARE
  invalid_scopes text;
BEGIN
  SELECT string_agg(target.project_number, ', ' ORDER BY target.project_number)
  INTO invalid_scopes
  FROM methodology_018_target AS target
  WHERE (SELECT count(*) FROM deliverable
         WHERE deliverable.gate_id = target.gate_id
           AND deliverable.template_id IS NOT NULL) <> 18
     OR NOT EXISTS (
       SELECT 1
       FROM deliverable AS site_plan
       JOIN deliverable AS governance
         ON governance.gate_id = site_plan.gate_id
        AND governance.template_id = 'project_governance_escalation_plan'
       WHERE site_plan.gate_id = target.gate_id
         AND site_plan.template_id = 'project_site_organization_ehs_plan'
         AND site_plan.sequence = governance.sequence + 1
         AND site_plan.status = 'not_started'
         AND site_plan.applicability = 'applicable'
         AND site_plan.applicability_justification IS NULL
         AND site_plan.applicability_decided_at IS NULL
         AND site_plan.applicability_decided_by_user_id IS NULL
         AND site_plan.applicability_decided_by_display_name IS NULL
         AND site_plan.applicability_origin = 'template'
         AND site_plan.applicability_locked = false
     );

  IF invalid_scopes IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 did not establish the expected Project Baseline methodology for Projects: %', invalid_scopes;
  END IF;

  SELECT string_agg(package.package_code, ', ' ORDER BY package.package_code)
  INTO invalid_scopes
  FROM project_package AS package
  LEFT JOIN deliverable AS package_default
    ON package_default.package_id = package.id
   AND package_default.scope_level = 'package'
   AND package_default.template_id IS NOT NULL
  GROUP BY package.id, package.package_code
  HAVING count(package_default.id) <> 42;

  IF invalid_scopes IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 018 expected Package methodology to remain at 42 defaults for Packages: %', invalid_scopes;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM deliverable
    WHERE template_id IS NOT NULL
    GROUP BY gate_id, template_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration 018 found duplicate default Deliverables.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM deliverable
    WHERE template_id = 'project_site_organization_ehs_plan'
      AND (scope_level <> 'project' OR stage_id <> 'definition_design' OR package_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Migration 018 found the Project Site Organization & EHS Plan outside Project Definition & Design.';
  END IF;
END;
$$;
