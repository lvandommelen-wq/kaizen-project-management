ALTER TABLE gate_criterion
  ADD COLUMN applicability text,
  ADD COLUMN applicability_justification text,
  ADD COLUMN applicability_decided_at timestamptz,
  ADD COLUMN applicability_decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN applicability_decided_by_display_name text,
  ADD COLUMN applicability_origin text NOT NULL DEFAULT 'legacy',
  ADD COLUMN applicability_locked boolean NOT NULL DEFAULT false;

ALTER TABLE deliverable
  ADD COLUMN applicability text,
  ADD COLUMN applicability_justification text,
  ADD COLUMN applicability_decided_at timestamptz,
  ADD COLUMN applicability_decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN applicability_decided_by_display_name text,
  ADD COLUMN applicability_origin text NOT NULL DEFAULT 'legacy',
  ADD COLUMN applicability_locked boolean NOT NULL DEFAULT false;

UPDATE gate_criterion AS criterion
SET applicability = CASE
  WHEN criterion.status = 'not_applicable' THEN 'not_applicable'
  WHEN criterion.status = 'completed' OR criterion.template_id IS NULL THEN 'applicable'
  WHEN EXISTS (
    SELECT 1
    FROM gate_review_cycle AS cycle
    CROSS JOIN LATERAL jsonb_array_elements(cycle.frozen_evidence -> 'criteria') AS item
    WHERE cycle.gate_id = criterion.gate_id
      AND item ->> 'criterionId' = criterion.id
      AND item ->> 'status' <> 'not_applicable'
  ) THEN 'applicable'
  WHEN EXISTS (
    SELECT 1
    FROM gate_review_cycle AS cycle
    CROSS JOIN LATERAL jsonb_array_elements(cycle.frozen_evidence -> 'criteria') AS item
    WHERE cycle.gate_id = criterion.gate_id
      AND item ->> 'criterionId' = criterion.id
      AND item ->> 'status' = 'not_applicable'
  ) THEN 'not_applicable'
  ELSE 'to_be_determined'
END;

UPDATE deliverable
SET applicability = CASE
  WHEN status = 'not_applicable' THEN 'not_applicable'
  WHEN status IN ('in_progress', 'completed') OR template_id IS NULL THEN 'applicable'
  WHEN EXISTS (
    SELECT 1
    FROM gate_review_cycle AS cycle
    CROSS JOIN LATERAL jsonb_array_elements(cycle.frozen_evidence -> 'deliverables') AS item
    WHERE cycle.gate_id = deliverable.gate_id
      AND item ->> 'deliverableId' = deliverable.id
      AND item ->> 'status' <> 'not_applicable'
  ) THEN 'applicable'
  WHEN EXISTS (
    SELECT 1
    FROM gate_review_cycle AS cycle
    CROSS JOIN LATERAL jsonb_array_elements(cycle.frozen_evidence -> 'deliverables') AS item
    WHERE cycle.gate_id = deliverable.gate_id
      AND item ->> 'deliverableId' = deliverable.id
      AND item ->> 'status' = 'not_applicable'
  ) THEN 'not_applicable'
  ELSE 'to_be_determined'
END;

UPDATE gate_criterion SET status = 'pending' WHERE status = 'not_applicable';
UPDATE deliverable SET status = 'not_started' WHERE status = 'not_applicable';

ALTER TABLE gate_criterion
  ALTER COLUMN applicability SET NOT NULL,
  ALTER COLUMN applicability SET DEFAULT 'to_be_determined',
  DROP CONSTRAINT gate_criterion_status_check,
  ADD CONSTRAINT gate_criterion_status_check CHECK (status IN ('pending', 'completed')),
  ADD CONSTRAINT gate_criterion_applicability_check CHECK (
    applicability IN ('applicable', 'not_applicable', 'to_be_determined')
  ),
  ADD CONSTRAINT gate_criterion_applicability_origin_check CHECK (
    applicability_origin IN ('legacy', 'template', 'user')
  ),
  ADD CONSTRAINT gate_criterion_applicability_state_check CHECK (
    (applicability = 'applicable' OR status = 'pending')
    AND (applicability = 'not_applicable' OR applicability_justification IS NULL)
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

ALTER TABLE deliverable
  ALTER COLUMN applicability SET NOT NULL,
  ALTER COLUMN applicability SET DEFAULT 'to_be_determined',
  DROP CONSTRAINT deliverable_status_check,
  ADD CONSTRAINT deliverable_status_check CHECK (
    status IN ('not_started', 'in_progress', 'completed')
  ),
  ADD CONSTRAINT deliverable_applicability_check CHECK (
    applicability IN ('applicable', 'not_applicable', 'to_be_determined')
  ),
  ADD CONSTRAINT deliverable_applicability_origin_check CHECK (
    applicability_origin IN ('legacy', 'template', 'user')
  ),
  ADD CONSTRAINT deliverable_applicability_state_check CHECK (
    (applicability = 'applicable' OR status = 'not_started')
    AND (applicability = 'not_applicable' OR applicability_justification IS NULL)
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

CREATE TABLE applicability_change (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id text NOT NULL,
  package_id text,
  gate_id text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('criterion', 'deliverable')),
  item_id text NOT NULL,
  template_id text,
  previous_applicability text CHECK (
    previous_applicability IS NULL
    OR previous_applicability IN ('applicable', 'not_applicable', 'to_be_determined')
  ),
  applicability text NOT NULL CHECK (
    applicability IN ('applicable', 'not_applicable', 'to_be_determined')
  ),
  justification text,
  change_reason text,
  previous_completion_status text,
  completion_status text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  changed_by_display_name text NOT NULL CHECK (btrim(changed_by_display_name) <> ''),
  changed_by_email text,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (gate_id, project_id)
    REFERENCES gate(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (gate_id, package_id)
    REFERENCES gate(id, package_id) ON DELETE CASCADE,
  CHECK (
    (package_id IS NULL OR package_id <> '')
    AND (applicability = 'not_applicable' OR justification IS NULL)
    AND (
      applicability <> 'not_applicable'
      OR coalesce(btrim(justification), '') <> ''
    )
  )
);

CREATE INDEX applicability_change_scope_idx
  ON applicability_change(project_id, package_id, changed_at DESC, id);
CREATE INDEX applicability_change_item_idx
  ON applicability_change(item_type, item_id, changed_at DESC, id);

CREATE TRIGGER applicability_change_history_guard
BEFORE UPDATE OR DELETE ON applicability_change
FOR EACH ROW EXECUTE FUNCTION reject_historical_record_change();

WITH definitions(scope_level, stage_id, template_id, description, locked) AS (
  VALUES
    ('project', 'initiation', 'stage_gate_methodology_tailored', 'Project Stage-Gate methodology has been reviewed and tailored, including Deliverable applicability, Gate Criteria and applicable Package governance requirements.', true),
    ('project', 'definition_design', 'maintenance_reliability_strategy_defined', 'Project Maintenance & Reliability Strategy is defined and approved where applicable.', false),
    ('project', 'delivery', 'maintenance_reliability_readiness_assessed', 'Maintenance & Reliability readiness has been assessed across applicable Packages, and outstanding critical items are resolved or formally accepted.', false),
    ('package', 'definition', 'maintenance_reliability_requirements_defined', 'Maintenance & Reliability requirements, responsibilities and required analysis depth are sufficiently defined.', false),
    ('package', 'execution', 'maintenance_readiness_demonstrated', 'Maintenance readiness is demonstrated, including approved maintenance strategy, verified CMMS/EAM integration, critical spare-parts readiness, defined support responsibilities and required personnel qualifications.', false)
), candidates AS (
  SELECT gate.id AS gate_id, definitions.template_id, definitions.description,
    definitions.locked,
    coalesce((SELECT max(sequence) FROM gate_criterion WHERE gate_id = gate.id), 0)
      + row_number() OVER (PARTITION BY gate.id ORDER BY definitions.template_id) AS sequence
  FROM gate
  JOIN definitions ON definitions.scope_level = gate.scope_level
    AND definitions.stage_id = gate.stage_id
  WHERE gate.status <> 'submitted_for_approval'
)
INSERT INTO gate_criterion (
  id, gate_id, sequence, template_id, description, status, applicability,
  applicability_origin, applicability_locked
)
SELECT gate_id || ':' || template_id, gate_id, sequence, template_id,
  description, 'pending', CASE WHEN locked THEN 'applicable' ELSE 'to_be_determined' END,
  'template', locked
FROM candidates
ON CONFLICT (gate_id, template_id) DO NOTHING;

WITH definitions(
  scope_level, stage_id, template_version, template_id, title, description, locked
) AS (
  VALUES
    ('project', 'initiation', 3, 'project_stage_gate_applicability_matrix', 'Project Stage-Gate Applicability Matrix', 'Generated from the structured Project applicability configuration and frozen with the Project Authorization Review Cycle.', true),
    ('project', 'definition_design', 5, 'project_maintenance_reliability_strategy', 'Project Maintenance & Reliability Strategy', 'Defines the project-wide reliability methodology, applicable criticality assessments, CMMS/EAM standards, maintenance responsibilities, supplier requirements and operational handover expectations.', false),
    ('project', 'delivery', 4, 'maintenance_reliability_readiness_overview', 'Maintenance & Reliability Readiness Overview', 'Consolidates maintenance readiness across applicable Packages, including maintenance strategy, CMMS/EAM integration, spare parts, support and training.', false),
    ('package', 'definition', 4, 'maintenance_reliability_requirements', 'Maintenance & Reliability Requirements', 'Defines maintainability requirements, applicable ACA/FLOCCA/FMECA/RCM2 analysis depth, CMMS/EAM master data, spare parts, training and support requirements.', false),
    ('package', 'tendering', 3, 'maintenance_reliability_evaluation', 'Maintenance & Reliability Evaluation', 'Evaluates external supplier or internal execution proposals regarding maintainability, lifecycle cost, spare parts, maintenance support and training.', false),
    ('package', 'execution', 4, 'maintenance_strategy_reliability_assessment', 'Maintenance Strategy & Reliability Assessment', 'Approved reactive, preventive, predictive/condition-based and failure-finding maintenance strategy as applicable, supported by ACA, FLOCCA, FMECA/RCM2 or other required analyses.', false),
    ('package', 'execution', 4, 'cmms_eam_master_data_handover', 'CMMS / EAM Master Data Handover', 'Asset hierarchy, functional locations, equipment records, BOMs, task lists, maintenance plans and counters where applicable, including verification of correct CMMS/EAM implementation.', false),
    ('package', 'execution', 4, 'maintenance_support_spare_parts_plan', 'Maintenance Support & Spare Parts Plan', 'Critical spare-parts assessment and availability, OEM/SLA support arrangements and L1 operator / L2 internal maintenance / L3 OEM intervention and escalation matrix.', false),
    ('package', 'execution', 4, 'training_qualification_matrix', 'Training & Qualification Matrix', 'Operator and maintenance competency requirements, training completion and qualification evidence, including intervention authorization where applicable.', false)
), candidates AS (
  SELECT gate.id AS gate_id, gate.project_id, gate.package_id,
    gate.stage_id AS gate_stage_id, gate.scope_level AS gate_scope_level,
    definitions.template_version, definitions.template_id, definitions.title,
    definitions.description, definitions.locked,
    coalesce((SELECT max(sequence) FROM deliverable WHERE gate_id = gate.id), 0)
      + row_number() OVER (PARTITION BY gate.id ORDER BY definitions.template_id) AS sequence
  FROM gate
  JOIN definitions ON definitions.scope_level = gate.scope_level
    AND definitions.stage_id = gate.stage_id
  WHERE gate.status <> 'submitted_for_approval'
)
INSERT INTO deliverable (
  id, template_id, template_version, project_id, package_id, gate_id, sequence,
  title, description, status, stage_id, scope_level, created_at, updated_at,
  applicability, applicability_origin, applicability_locked
)
SELECT gate_id || ':deliverable:' || template_id, template_id, template_version,
  project_id, package_id, gate_id, sequence, title, description, 'not_started',
  gate_stage_id, gate_scope_level, now(), now(),
  CASE WHEN locked THEN 'applicable' ELSE 'to_be_determined' END, 'template', locked
FROM candidates
ON CONFLICT (gate_id, template_id) WHERE template_id IS NOT NULL DO NOTHING;

WITH links(deliverable_template_id, criterion_template_id) AS (
  VALUES
    ('project_stage_gate_applicability_matrix', 'stage_gate_methodology_tailored'),
    ('project_maintenance_reliability_strategy', 'maintenance_reliability_strategy_defined'),
    ('maintenance_reliability_readiness_overview', 'maintenance_reliability_readiness_assessed'),
    ('maintenance_reliability_requirements', 'maintenance_reliability_requirements_defined'),
    ('maintenance_strategy_reliability_assessment', 'maintenance_readiness_demonstrated'),
    ('cmms_eam_master_data_handover', 'maintenance_readiness_demonstrated'),
    ('maintenance_support_spare_parts_plan', 'maintenance_readiness_demonstrated'),
    ('training_qualification_matrix', 'maintenance_readiness_demonstrated'),
    ('training_qualification_matrix', 'training_complete')
), resolved AS (
  SELECT deliverable.id AS deliverable_id, criterion.id AS criterion_id,
    deliverable.gate_id,
    row_number() OVER (PARTITION BY deliverable.id ORDER BY links.criterion_template_id) AS sequence
  FROM links
  JOIN deliverable ON deliverable.template_id = links.deliverable_template_id
  JOIN gate_criterion AS criterion ON criterion.gate_id = deliverable.gate_id
    AND criterion.template_id = links.criterion_template_id
)
INSERT INTO deliverable_criterion(deliverable_id, criterion_id, gate_id, sequence)
SELECT deliverable_id, criterion_id, gate_id, sequence
FROM resolved
ON CONFLICT (deliverable_id, criterion_id) DO NOTHING;

UPDATE gate SET template_version = CASE
  WHEN scope_level = 'project' AND stage_id = 'initiation' THEN greatest(template_version, 3)
  WHEN scope_level = 'project' AND stage_id = 'definition_design' THEN greatest(template_version, 5)
  WHEN scope_level = 'project' AND stage_id = 'delivery' THEN greatest(template_version, 4)
  WHEN scope_level = 'package' AND stage_id = 'definition' THEN greatest(template_version, 4)
  WHEN scope_level = 'package' AND stage_id = 'tendering' THEN greatest(template_version, 3)
  WHEN scope_level = 'package' AND stage_id = 'execution' THEN greatest(template_version, 4)
  ELSE template_version
END
WHERE status <> 'submitted_for_approval';
