-- Deliverables-only Stage-Gate methodology. Legacy Criteria tables remain intact and inactive.

DO $$
DECLARE
  affected text;
BEGIN
  SELECT string_agg(
    project.project_number || ' / ' || coalesce(package.package_code || ' / ', '') ||
    gate.name || ' / Review Cycle ' || cycle.cycle_number, E'\n' ORDER BY project.project_number, package.package_code, gate.sequence
  ) INTO affected
  FROM gate_review_cycle AS cycle
  JOIN gate ON gate.id = cycle.gate_id
  JOIN project ON project.id = gate.project_id
  LEFT JOIN project_package AS package ON package.id = gate.package_id
  WHERE cycle.status = 'awaiting_approval';

  IF affected IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 015 stopped because Review Cycles await approval:%', E'\n' || affected;
  END IF;
END;
$$;

DO $$
DECLARE
  ambiguous text;
BEGIN
  SELECT string_agg(criterion.id || ' (' || gate.name || ')', ', ' ORDER BY criterion.id)
  INTO ambiguous
  FROM gate_criterion AS criterion
  JOIN gate ON gate.id = criterion.gate_id
  JOIN deliverable_criterion AS link ON link.criterion_id = criterion.id
  JOIN deliverable ON deliverable.id = link.deliverable_id
  WHERE criterion.template_id IS NULL AND deliverable.template_id IS NULL
  GROUP BY criterion.id, gate.name
  HAVING count(*) > 1
  LIMIT 1;

  IF ambiguous IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 015 requires manual review for custom Criteria linked to multiple custom Deliverables: %', ambiguous;
  END IF;
END;
$$;

-- A custom Criterion already linked to one custom Deliverable is treated as covered.
-- Every other independent custom Criterion becomes one custom Deliverable.
WITH candidates AS (
  SELECT criterion.*, gate.project_id, gate.package_id, gate.stage_id, gate.scope_level,
    row_number() OVER (PARTITION BY gate.id ORDER BY criterion.sequence, criterion.id) AS added_sequence,
    coalesce((SELECT max(sequence) FROM deliverable WHERE gate_id = gate.id), 0) AS sequence_base
  FROM gate_criterion AS criterion
  JOIN gate ON gate.id = criterion.gate_id
  WHERE criterion.template_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM deliverable_criterion AS link
      JOIN deliverable ON deliverable.id = link.deliverable_id
      WHERE link.criterion_id = criterion.id AND deliverable.template_id IS NULL
    )
), inserted AS (
  INSERT INTO deliverable (
    id, template_id, template_version, project_id, package_id, gate_id, sequence,
    title, description, status, stage_id, scope_level, created_at, updated_at,
    applicability, applicability_justification, applicability_decided_at,
    applicability_decided_by_user_id, applicability_decided_by_display_name,
    applicability_origin, applicability_locked
  )
  SELECT criterion.id || ':legacy-deliverable', NULL, NULL, project_id, package_id, gate_id,
    sequence_base + added_sequence,
    'Migrated requirement — ' || left(criterion.description, 120),
    'Migrated from legacy Gate Criterion ' || criterion.id || '. Acceptance requirement: ' || criterion.description,
    CASE WHEN criterion.status = 'completed' THEN 'completed' ELSE 'not_started' END,
    stage_id, scope_level, now(), now(), criterion.applicability,
    criterion.applicability_justification, criterion.applicability_decided_at,
    criterion.applicability_decided_by_user_id, criterion.applicability_decided_by_display_name,
    criterion.applicability_origin, false
  FROM candidates AS criterion
  ON CONFLICT (id) DO NOTHING
  RETURNING id, gate_id
)
INSERT INTO deliverable_criterion (deliverable_id, criterion_id, gate_id, sequence)
SELECT inserted.id, left(inserted.id, length(inserted.id) - length(':legacy-deliverable')), inserted.gate_id, 1
FROM inserted
ON CONFLICT (deliverable_id, criterion_id) DO NOTHING;

CREATE TEMP TABLE methodology_015_target (
  scope_level text NOT NULL,
  stage_id text NOT NULL,
  sequence integer NOT NULL,
  template_version integer NOT NULL,
  template_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  applicability_locked boolean NOT NULL,
  source_template_ids text[] NOT NULL,
  PRIMARY KEY (scope_level, stage_id, template_id)
) ON COMMIT DROP;

INSERT INTO methodology_015_target VALUES
  ('project', 'initiation', 1, 6, 'project_charter', 'Project Charter / Project Brief / One-pager', 'Accepted when it defines the business need, objectives, expected benefits, initial organization, key stakeholders, initial Risks, material Decisions and their justification at a level sufficient to authorize further Project definition.', false, ARRAY['project_charter']::text[]),
  ('project', 'initiation', 2, 6, 'preliminary_project_scope', 'Preliminary Project Scope', 'Accepted when the initial Scope, boundaries, major assumptions, exclusions and expected outcomes are documented and sufficiently clear for authorization.', false, ARRAY['preliminary_project_scope']::text[]),
  ('project', 'initiation', 3, 6, 'initial_budget', 'Initial Budget', 'Accepted when an initial Cost estimate, principal assumptions, expected funding need and material uncertainty are documented and aligned with the current preliminary Scope.', false, ARRAY['initial_budget']::text[]),
  ('project', 'initiation', 4, 6, 'initial_master_schedule', 'Initial Master Schedule / Milestone Plan', 'Accepted when the required completion date, principal milestones, major dependencies and initial Schedule assumptions are documented.', false, ARRAY['initial_master_schedule']::text[]),
  ('project', 'initiation', 5, 6, 'initial_project_raci', 'Initial Project RACI', 'Accepted when the Project Manager, initial Project organization and key responsibilities and accountabilities are identified.', false, ARRAY['initial_project_raci']::text[]),
  ('project', 'initiation', 6, 6, 'business_case_roi', 'Business Case / ROI — where applicable', 'Accepted when the investment rationale, expected benefits, material assumptions and available financial evaluation are documented and the Project remains justified.', false, ARRAY['business_case_roi']::text[]),
  ('project', 'initiation', 7, 6, 'project_stage_gate_applicability_matrix', 'Project Stage-Gate Deliverable Applicability Matrix', 'Accepted when every default and custom Project Deliverable across the active lifecycle has an Applicable or justified Not Applicable decision. The generated matrix is frozen with the Project Authorization Review Cycle.', true, ARRAY['project_stage_gate_applicability_matrix']::text[]),
  ('project', 'definition_design', 1, 6, 'approved_project_scope', 'Approved Project Scope', 'Accepted when the overall Scope, boundaries, assumptions, exclusions, principal outputs and acceptance basis are defined and ready for formal baseline approval.', false, ARRAY['approved_project_scope']::text[]),
  ('project', 'definition_design', 2, 6, 'approved_overall_requirements', 'Approved URS / Overall Requirements', 'Accepted when overall user and Project requirements are complete enough for Package definition, verification planning and formal approval, with material conflicts or gaps resolved or controlled.', false, ARRAY['approved_overall_requirements']::text[]),
  ('project', 'definition_design', 3, 6, 'project_maintenance_reliability_strategy', 'Project Maintenance & Reliability Strategy', 'Accepted when the Project-wide reliability methodology, criticality approach, CMMS/EAM standards, maintenance responsibilities, supplier requirements and operational handover expectations are defined and approved where applicable.', false, ARRAY['project_maintenance_reliability_strategy']::text[]),
  ('project', 'definition_design', 4, 6, 'production_integration_master_data_strategy', 'Production Integration & Master Data Strategy', 'Accepted when the ERP/MES integration architecture, system responsibilities, master-data ownership, production-order handling, BOM/recipe requirements, material and traceability flows, Interfaces and handover responsibilities are defined.', false, ARRAY['production_integration_master_data_strategy']::text[]),
  ('project', 'definition_design', 5, 6, 'project_training_qualification_requirements_matrix', 'Project Training & Qualification Requirements Matrix', 'Accepted when the required operator, maintenance and other role-based training, competency, qualification and authorization requirements are defined and allocated to the Packages that must satisfy them during Execution.', false, ARRAY[]::text[]),
  ('project', 'definition_design', 6, 6, 'concept_basic_design', 'Concept / Basic Design', 'Accepted when the selected concept and basic design are sufficiently mature to support the Scope, Package breakdown, baseline and subsequent detailed execution.', false, ARRAY['concept_basic_design']::text[]),
  ('project', 'definition_design', 7, 6, 'master_layout', 'Master Layout', 'Accepted when the Master Layout is approved at the required maturity and material spatial, operational, safety and Package-interface constraints are represented.', false, ARRAY['master_layout']::text[]),
  ('project', 'definition_design', 8, 6, 'package_breakdown_scope_structure', 'Package Breakdown / Scope Structure', 'Accepted when the Project Scope is divided into coherent Packages with clear boundaries, ownership and an execution approach appropriate to the current maturity.', false, ARRAY['package_breakdown_scope_structure']::text[]),
  ('project', 'definition_design', 9, 6, 'project_budget_baseline_ready', 'Project Budget Baseline', 'Accepted when the Cost baseline is complete, internally consistent, aligned with Scope and Schedule, and ready for formal approval.', false, ARRAY['project_budget_baseline_ready']::text[]),
  ('project', 'definition_design', 10, 6, 'master_schedule_baseline_ready', 'Master Schedule Baseline', 'Accepted when the integrated Schedule baseline includes the required milestones, dependencies and Package interfaces and is ready for formal approval.', false, ARRAY['master_schedule_baseline_ready']::text[]),
  ('project', 'definition_design', 11, 6, 'project_governance_escalation_plan', 'Project Governance, RACI & Escalation Plan', 'Accepted when Project responsibilities, Decision authority, Governance Tiers, meeting structure, escalation paths, participants, reviewed registers and escalation triggers are defined.', false, ARRAY['project_governance_escalation_plan', 'project_raci']::text[]),
  ('project', 'definition_design', 12, 6, 'procurement_execution_strategy', 'Procurement / Execution Strategy', 'Accepted when the intended procurement and execution approaches, contracting assumptions, internal-versus-external considerations and major sequencing decisions are documented.', false, ARRAY['procurement_execution_strategy']::text[]),
  ('project', 'definition_design', 13, 6, 'initial_interface_structure', 'Interface Definition / Initial Interface Structure', 'Accepted when major Project and Package boundaries and Interfaces are identified, assigned and placed under an appropriate living Interface-control structure.', false, ARRAY['initial_interface_structure']::text[]),
  ('project', 'definition_design', 14, 6, 'validation_strategy_plan', 'Validation Strategy / Plan — where applicable', 'Accepted when the Validation scope, responsibilities, approach, required qualification activities, evidence and release path are defined, or the Deliverable is justified Not Applicable.', false, ARRAY['validation_strategy_plan']::text[]),
  ('project', 'definition_design', 15, 6, 'initial_traceability_structure', 'Initial RTM / Traceability Structure', 'Accepted when a usable requirements traceability structure is established, requirements are assigned to appropriate verification routes and ownership for maintaining traceability is defined.', false, ARRAY['initial_traceability_structure']::text[]),
  ('project', 'definition_design', 16, 6, 'project_risk_issue_assessment', 'Project Risk & Issue Assessment', 'Accepted when material Project Risks and Issues have been assessed, responses or owners assigned, and the Deliverable references the current living Risk and Issue registers rather than duplicating them.', false, ARRAY[]::text[]),
  ('project', 'definition_design', 17, 6, 'updated_business_case_investment_justification', 'Updated Business Case / Investment Justification', 'Accepted when the investment remains justified against the developed Scope, Cost, Schedule, benefits and material Risks, and significant changes from authorization are explained.', false, ARRAY[]::text[]),
  ('project', 'delivery', 1, 6, 'package_handover_records', 'Package Handover Records', 'Accepted when all required Packages have reached their required handover or completion state and their approved handover evidence is available for Project review.', false, ARRAY['package_handover_records']::text[]),
  ('project', 'delivery', 2, 6, 'maintenance_reliability_readiness_overview', 'Maintenance & Reliability Readiness Overview', 'Accepted when maintenance readiness is consolidated across applicable Packages, including maintenance strategies, spare parts, support, training and outstanding critical items, with unresolved items controlled or formally accepted.', false, ARRAY['maintenance_reliability_readiness_overview']::text[]),
  ('project', 'delivery', 3, 6, 'cmms_eam_integration_verification', 'CMMS / EAM Integration & Verification', 'Accepted when applicable Package asset and maintenance data have been consolidated, integrated into the receiving CMMS/EAM environment and verified for completeness and correct implementation.', false, ARRAY[]::text[]),
  ('project', 'delivery', 4, 6, 'production_readiness_integration_overview', 'Production Readiness & Integration Overview', 'Accepted when production readiness across Packages is consolidated, cross-Package Interfaces are resolved, operational procedures and training are complete, and outstanding integration items are controlled and accepted by the receiving organization.', false, ARRAY['production_readiness_integration_overview']::text[]),
  ('project', 'delivery', 5, 6, 'production_master_data_integration_verification', 'Production Master Data Integration & Verification', 'Accepted when applicable Package production master-data inputs have been consolidated, integrated into the receiving ERP/MES environment and verified for completeness and correct implementation.', false, ARRAY[]::text[]),
  ('project', 'delivery', 6, 6, 'integrated_sat_evidence', 'Integrated SAT / System Test Evidence — where applicable', 'Accepted when required integrated or system-level tests are completed against approved requirements, results and deviations are documented, and duplicate Package testing is avoided by reusing valid evidence.', false, ARRAY['integrated_sat_evidence']::text[]),
  ('project', 'delivery', 7, 6, 'integrated_system_safety_release_checklist', 'Integrated Line / System Safety Release Checklist', 'Accepted when cross-Package safety Interfaces and overall integrated-system readiness have been reviewed, blocking safety issues are resolved and the system is authorized for the intended next activity where applicable.', false, ARRAY[]::text[]),
  ('project', 'delivery', 8, 6, 'updated_master_layout', 'Updated Master Layout / appropriate as-built maturity', 'Accepted when the Master Layout reflects the delivered installation at the maturity required for handover, Validation or Closure and material deviations are controlled.', false, ARRAY['updated_master_layout']::text[]),
  ('project', 'delivery', 9, 6, 'handover_documentation', 'Handover Documentation', 'Accepted when the required operating, maintenance, engineering and handover documentation is available, controlled and transferred to the responsible receiving parties.', false, ARRAY['handover_documentation']::text[]),
  ('project', 'delivery', 10, 6, 'training_documentation', 'Training Documentation', 'Accepted when required Project-level and Package-derived training and qualification evidence is complete, traceable to the approved requirements and available to the receiving organization.', false, ARRAY['training_documentation']::text[]),
  ('project', 'delivery', 11, 6, 'snag_overview', 'Outstanding Items / SNAG / Risk & Issue Disposition', 'Accepted when critical blocking items are closed and every remaining non-critical SNAG, Action, Risk or Issue is documented, owned, due-dated and formally accepted or transferred.', false, ARRAY['snag_overview']::text[]),
  ('project', 'delivery', 12, 6, 'updated_verification_evidence', 'Updated RTM / Verification Evidence', 'Accepted when the RTM is current, requirements applicable to Delivery have appropriate verification evidence, and unresolved gaps or approved Changes are clearly dispositioned.', false, ARRAY['updated_verification_evidence']::text[]),
  ('project', 'validation', 1, 6, 'iq_protocol_report', 'IQ Protocol and Report', 'Accepted when applicable installation qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision.', false, ARRAY['iq_protocol_report']::text[]),
  ('project', 'validation', 2, 6, 'oq_protocol_report', 'OQ Protocol and Report', 'Accepted when applicable operational qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision.', false, ARRAY['oq_protocol_report']::text[]),
  ('project', 'validation', 3, 6, 'pq_protocol_report', 'PQ Protocol and Report', 'Accepted when applicable performance qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision.', false, ARRAY['pq_protocol_report']::text[]),
  ('project', 'validation', 4, 6, 'validation_deviation_documentation', 'Validation Deviation Documentation', 'Accepted when Validation deviations are documented, assessed and closed or formally dispositioned without invalidating approved qualification evidence.', false, ARRAY['validation_deviation_documentation']::text[]),
  ('project', 'validation', 5, 6, 'final_rtm', 'Final RTM / Validation Traceability Evidence', 'Accepted when requirements traceability is complete, critical requirements have appropriate Verification or Validation evidence and the effect of applicable Changes is accounted for.', false, ARRAY['final_rtm']::text[]),
  ('project', 'validation', 6, 6, 'validation_summary_report', 'Validation Summary Report', 'Accepted when the completed Validation scope, results, deviations, residual Risks and conclusion are summarized and approved.', false, ARRAY['validation_summary_report']::text[]),
  ('project', 'validation', 7, 6, 'formal_release_evidence', 'Formal Release / Approval Evidence — where applicable', 'Accepted when the required system or process release is formally recorded by the authorized parties, or the Deliverable is justified Not Applicable.', false, ARRAY['formal_release_evidence']::text[]),
  ('project', 'closure', 1, 6, 'final_as_built_scope', 'Final / As-Built Project Scope', 'Accepted when the final delivered Scope and material approved deviations are documented and reconciled to the current approved state.', false, ARRAY['final_as_built_scope']::text[]),
  ('project', 'closure', 2, 6, 'final_master_layout', 'Final Master Layout', 'Accepted when the controlled final Master Layout accurately represents the as-built Project state.', false, ARRAY['final_master_layout']::text[]),
  ('project', 'closure', 3, 6, 'final_budget_cost_report', 'Final Budget / Cost Report', 'Accepted when the final Cost position, commitments, actuals, approved Changes, remaining obligations and material variance explanations are established.', false, ARRAY['final_budget_cost_report']::text[]),
  ('project', 'closure', 4, 6, 'final_schedule_performance_report', 'Final Schedule Performance Report', 'Accepted when final milestone and Schedule performance, material variance and relevant causes are documented.', false, ARRAY['final_schedule_performance_report']::text[]),
  ('project', 'closure', 5, 6, 'final_rtm', 'Final RTM', 'Accepted when final requirements traceability and the disposition of Verification, Validation and approved Change evidence are complete.', false, ARRAY['final_rtm']::text[]),
  ('project', 'closure', 6, 6, 'final_handover_record', 'Final Project Handover & Acceptance Record', 'Accepted when a formal checklist identifies required handover Deliverables, outstanding obligations, responsible owners and receiving-party acceptance without duplicating signatures already provided by the Gate approval.', false, ARRAY['final_handover_record']::text[]),
  ('project', 'closure', 7, 6, 'project_evaluation', 'Project Post-Mortem / Evaluation', 'Accepted when Project performance, outcomes, Lessons Learned and improvement opportunities are evaluated and material follow-up is assigned.', false, ARRAY['project_evaluation', 'lessons_learned']::text[]),
  ('project', 'closure', 8, 6, 'customer_handover_package', 'Customer As-Built Handover Package', 'Accepted when the required final customer-facing as-built documentation package is complete, controlled and transferred.', false, ARRAY['customer_handover_package']::text[]),
  ('package', 'definition', 1, 6, 'package_scope', 'Package Scope & Interface Definition', 'Accepted when Package Scope, boundaries, assumptions, exclusions, responsibilities and material Project, Package and external Interfaces are defined and assigned.', false, ARRAY['package_scope', 'package_interface_definition']::text[]),
  ('package', 'definition', 2, 6, 'package_requirements', 'Package Requirements', 'Accepted when applicable functional, technical, performance, safety, Interface, documentation, FAT/SAT and acceptance requirements are sufficiently complete for supplier-facing tendering or internally executed detailed engineering.', false, ARRAY['package_requirements', 'technical_specification']::text[]),
  ('package', 'definition', 3, 6, 'maintenance_reliability_requirements', 'Maintenance & Reliability Requirements', 'Accepted when maintainability, reliability, applicable analysis depth, CMMS/EAM data, spare-parts, training, support and responsibility requirements are defined.', false, ARRAY['maintenance_reliability_requirements']::text[]),
  ('package', 'definition', 4, 6, 'production_integration_requirements', 'Production Integration Requirements', 'Accepted when applicable production-order, BOM/recipe, material identification and consumption, traceability, equipment-to-ERP/MES, automation and master-data responsibilities are defined.', false, ARRAY['production_integration_requirements']::text[]),
  ('package', 'definition', 5, 6, 'package_raci', 'Package RACI / Package Organization', 'Accepted when the Package owner, execution organization, responsibilities, accountabilities and material stakeholder roles are defined.', false, ARRAY['package_raci']::text[]),
  ('package', 'definition', 6, 6, 'package_milestone_requirements', 'Package Milestone Requirements', 'Accepted when required delivery dates, key milestones, dependencies and Schedule Interfaces are defined and aligned with the Master Schedule.', false, ARRAY['package_milestone_requirements']::text[]),
  ('package', 'definition', 7, 6, 'preliminary_internal_resource_estimate', 'Preliminary Internal Resource Estimate — where applicable', 'Accepted when preliminary internal discipline, capacity and timing needs are estimated where internal execution remains an option, or the Deliverable is justified Not Applicable.', false, ARRAY['preliminary_internal_resource_estimate']::text[]),
  ('package', 'definition', 8, 6, 'package_stage_gate_applicability_matrix', 'Package Stage-Gate Deliverable Applicability Matrix', 'Accepted when every default and custom Package Deliverable across the configured lifecycle has an Applicable or justified Not Applicable decision. The generated matrix is frozen with the Package Definition Complete Review Cycle.', true, ARRAY['package_stage_gate_applicability_matrix']::text[]),
  ('package', 'definition', 9, 6, 'package_risk_assessment', 'Package Risk Assessment', 'Accepted when material Package Risks are assessed, responses and owners are assigned, and the assessment references the living Risk register rather than duplicating it.', false, ARRAY[]::text[]),
  ('package', 'tendering', 1, 6, 'rfq_tender_package', 'RFQ / Tender Package', 'Accepted when approved Package Requirements are translated into a complete supplier-facing request including Scope, Interfaces, deliverables, commercial instructions and evaluation basis.', false, ARRAY['rfq_tender_package']::text[]),
  ('package', 'tendering', 2, 6, 'supplier_proposals', 'Supplier Proposal(s) — where applicable', 'Accepted when the required supplier proposals and material clarifications are received, controlled and suitable for evaluation, or the Deliverable is justified Not Applicable.', false, ARRAY['supplier_proposals']::text[]),
  ('package', 'tendering', 3, 6, 'technical_evaluation', 'Technical Evaluation / TECO — where applicable', 'Accepted when technical compliance, deviations, performance, safety, Interfaces, documentation, FAT/SAT, production integration and acceptance requirements are evaluated and material gaps are resolved or controlled.', false, ARRAY['technical_evaluation']::text[]),
  ('package', 'tendering', 4, 6, 'maintenance_reliability_evaluation', 'Maintenance & Reliability Evaluation', 'Accepted when external or internal proposals are evaluated for maintainability, reliability, lifecycle Cost, spare parts, maintenance support and training against approved requirements.', false, ARRAY['maintenance_reliability_evaluation']::text[]),
  ('package', 'tendering', 5, 6, 'internal_execution_proposal', 'Internal Execution Proposal — where applicable', 'Accepted when the internal solution, Scope, approach, responsibilities, assumptions, Cost, Schedule and Risks are defined sufficiently for comparison, or the Deliverable is justified Not Applicable.', false, ARRAY['internal_execution_proposal']::text[]),
  ('package', 'tendering', 6, 6, 'internal_resource_estimate', 'Internal Resource Estimate — where applicable', 'Accepted when required internal disciplines, effort, capacity and timing are sufficiently estimated for the Decision, or the Deliverable is justified Not Applicable.', false, ARRAY['internal_resource_estimate']::text[]),
  ('package', 'tendering', 7, 6, 'make_or_buy_recommendation', 'Execution Model & Technical Selection Recommendation and Decision Record', 'Accepted when technical evaluation, internal-versus-external feasibility, Cost and Schedule implications, Risks, major Interfaces, the recommended Execution Model and the formal Decision are recorded without duplicating Gate approvals.', false, ARRAY['make_or_buy_recommendation', 'final_technical_evaluation']::text[]),
  ('package', 'procurement', 1, 6, 'commercial_recommendation', 'Commercial Evaluation & Award Recommendation', 'Accepted when proposals are commercially compared, the negotiated position and Budget alignment are established, contractual Risks are understood and the supplier award recommendation is documented.', false, ARRAY['commercial_recommendation', 'commercial_comparison']::text[]),
  ('package', 'procurement', 2, 6, 'contract_cnd', 'Contract / CND', 'Accepted when the contractual instrument defines the agreed Scope, Interfaces, responsibilities, Schedule, deliverables, acceptance basis and applicable commercial terms, or is justified Not Applicable.', false, ARRAY['contract_cnd', 'contractual_scope', 'contractual_schedule']::text[]),
  ('package', 'procurement', 3, 6, 'cca_loi', 'CCA / LOI — where applicable', 'Accepted when any required conditional commitment or letter of intent is authorized, controlled and aligned with the intended award, or the Deliverable is justified Not Applicable.', false, ARRAY['cca_loi']::text[]),
  ('package', 'procurement', 4, 6, 'purchase_order', 'Purchase Order', 'Accepted when the authorized Purchase Order accurately reflects the approved supplier, value, contractual reference and required commercial commitment, or is justified Not Applicable under the configured execution route.', false, ARRAY['purchase_order', 'purchase_request']::text[]),
  ('package', 'execution', 1, 6, 'approved_design_documentation', 'Approved Design Documentation', 'Accepted when required design outputs and reviews are complete, controlled and approved at the maturity required for implementation and handover.', false, ARRAY['approved_design_documentation']::text[]),
  ('package', 'execution', 2, 6, 'fat_protocol_report', 'FAT Protocol / Report — where applicable', 'Accepted when applicable FAT scope and acceptance criteria are approved, testing is completed and results, deviations and disposition are documented, or the Deliverable is justified Not Applicable.', false, ARRAY['fat_protocol_report']::text[]),
  ('package', 'execution', 3, 6, 'installation_documentation', 'Installation Documentation — where applicable', 'Accepted when applicable installation plans, records, checks and deviations demonstrate completion to approved requirements, or the Deliverable is justified Not Applicable.', false, ARRAY['installation_documentation']::text[]),
  ('package', 'execution', 4, 6, 'commissioning_documentation', 'Commissioning Documentation — where applicable', 'Accepted when applicable commissioning plans, controlled test-operation arrangements, records, results and deviations demonstrate readiness for intended use or the next activity.', false, ARRAY['commissioning_documentation']::text[]),
  ('package', 'execution', 5, 6, 'sat_protocol_report', 'SAT Protocol / Report — where applicable', 'Accepted when applicable SAT or verification scope is approved, executed against Package Requirements and results and deviations are documented, or the Deliverable is justified Not Applicable.', false, ARRAY['sat_protocol_report']::text[]),
  ('package', 'execution', 6, 6, 'maintenance_strategy_reliability_assessment', 'Maintenance Strategy & Reliability Assessment', 'Accepted when the reactive, preventive, predictive or condition-based and failure-finding strategy is approved and supported by the required criticality and reliability analyses at a depth appropriate to the Package.', false, ARRAY['maintenance_strategy_reliability_assessment']::text[]),
  ('package', 'execution', 7, 6, 'cmms_eam_master_data_handover', 'CMMS / EAM Master Data Input Handover', 'Accepted when complete equipment-specific asset hierarchy, functional-location, equipment, BOM, task-list, maintenance-plan and counter inputs are prepared, quality-checked and handed over for Project-level integration.', false, ARRAY['cmms_eam_master_data_handover']::text[]),
  ('package', 'execution', 8, 6, 'maintenance_support_spare_parts_plan', 'Maintenance Support, Spare Parts & Spares Information', 'Accepted when critical and recommended spare parts, availability, OEM/SLA support, responsibilities and intervention and escalation arrangements are documented and handed over.', false, ARRAY['maintenance_support_spare_parts_plan', 'spare_parts_information']::text[]),
  ('package', 'execution', 9, 6, 'training_qualification_matrix', 'Package Training & Qualification Evidence', 'Accepted when Package obligations from the Project Training & Qualification Requirements Matrix are satisfied and operator and maintenance training, competency, qualification and intervention authorization evidence is complete.', false, ARRAY['training_qualification_matrix', 'training_records']::text[]),
  ('package', 'execution', 10, 6, 'production_master_data_handover', 'Production Master Data Input Handover', 'Accepted when complete equipment-specific production BOM, work-center, routing, recipe, material, production-version and other required ERP/MES master-data inputs are prepared, quality-checked and handed over for Project-level integration.', false, ARRAY['production_master_data_handover']::text[]),
  ('package', 'execution', 11, 6, 'production_interface_integration_verification', 'Production Interface & Integration Verification', 'Accepted when applicable production-order, recipe or parameter, material, confirmation, traceability and ERP/MES/equipment data exchanges, including failure and recovery behavior, are verified using existing FAT/SAT evidence where appropriate.', false, ARRAY['production_interface_integration_verification']::text[]),
  ('package', 'execution', 12, 6, 'production_operational_readiness_training', 'Production Operational Readiness & Training', 'Accepted when operating procedures, operator training and qualification, production responsibilities, master-data readiness and outstanding production issues are controlled and the receiving Production organization is ready.', false, ARRAY['production_operational_readiness_training']::text[]),
  ('package', 'execution', 13, 6, 'manuals', 'Manuals', 'Accepted when required operating, maintenance, engineering and supplier manuals are complete, controlled, usable and transferred to the responsible receiving parties.', false, ARRAY['manuals']::text[]),
  ('package', 'execution', 14, 6, 'snag_punch_list', 'SNAG / Punch List', 'Accepted when critical SNAGs are closed and every remaining item is documented, classified, owned, due-dated and formally accepted for follow-up.', false, ARRAY['snag_punch_list']::text[]),
  ('package', 'execution', 15, 6, 'equipment_safety_commissioning_release_checklist', 'Equipment Safety & Commissioning Release Checklist (Indienststelling)', 'Accepted before intended use when applicable EHS review, safety documentation, CE conformity, Risk assessment, safeguarding, emergency stops, LOTO and authorization for use are complete, while preserving controlled commissioning or test-operation arrangements.', false, ARRAY[]::text[]),
  ('package', 'execution', 16, 6, 'handover_record', 'Handover & Provisional Acceptance Record', 'Accepted when the receiving organization formally acknowledges the Package handover state, accepted outstanding obligations, ownership and any applicable provisional acceptance without duplicating Gate approval signatures.', false, ARRAY['handover_record', 'provisional_acceptance']::text[]),
  ('package', 'execution', 17, 6, 'updated_as_built_documentation', 'As-Built Documentation', 'Accepted when required drawings, software, settings, design records and other controlled documentation accurately represent the installed Package at the required final maturity.', false, ARRAY['updated_as_built_documentation']::text[]),
  ('package', 'closure', 1, 6, 'final_as_built_package', 'Final As-Built Package', 'Accepted when the final controlled Package documentation is complete, represents the delivered state and is ready for Project and customer handover.', false, ARRAY['final_as_built_package']::text[]),
  ('package', 'closure', 2, 6, 'final_package_cost_summary', 'Final Package Cost Summary', 'Accepted when the final Package Cost position, commitments, actuals, approved Changes, remaining obligations and material variance are established from the Project Cost records.', false, ARRAY['final_package_cost_summary']::text[]),
  ('package', 'closure', 3, 6, 'final_acceptance_documentation', 'Final Acceptance Documentation — where applicable', 'Accepted when applicable final acceptance conditions and supplier obligations are satisfied and formally documented, or the Deliverable is justified Not Applicable.', false, ARRAY['final_acceptance_documentation']::text[]),
  ('package', 'closure', 4, 6, 'warranty_documentation', 'Warranty Documentation — where applicable', 'Accepted when applicable warranty terms, dates, conditions, contacts, exclusions and follow-up ownership are documented and transferred, or the Deliverable is justified Not Applicable.', false, ARRAY['warranty_documentation']::text[]),
  ('package', 'closure', 5, 6, 'package_lessons_learned', 'Package Post-Mortem', 'Accepted when supplier or internal execution performance, outcomes, Lessons Learned and improvement opportunities are evaluated and material follow-up is assigned.', false, ARRAY['package_lessons_learned', 'supplier_performance_evaluation']::text[]);

CREATE TEMP TABLE methodology_015_resolution ON COMMIT DROP AS
SELECT gate.id AS gate_id, gate.project_id, gate.package_id, gate.status AS gate_status,
  target.*, survivor.id AS survivor_id, survivor.status AS survivor_status,
  survivor.applicability AS survivor_applicability,
  survivor.applicability_justification AS survivor_justification,
  survivor.applicability_decided_at AS survivor_decided_at,
  survivor.applicability_decided_by_user_id AS survivor_decided_by_user_id,
  survivor.applicability_decided_by_display_name AS survivor_decided_by_display_name,
  survivor.applicability_origin AS survivor_origin,
  aggregate.source_count, aggregate.all_not_applicable, aggregate.all_applicable_completed,
  aggregate.any_applicable_progress, aggregate.combined_justification
FROM methodology_015_target AS target
JOIN gate ON gate.scope_level = target.scope_level AND gate.stage_id = target.stage_id
  AND gate.status IN ('not_submitted', 'returned_for_rework')
LEFT JOIN LATERAL (
  SELECT deliverable.*
  FROM deliverable
  WHERE deliverable.gate_id = gate.id
    AND deliverable.template_id = ANY(target.source_template_ids)
  ORDER BY array_position(target.source_template_ids, deliverable.template_id), deliverable.sequence, deliverable.id
  LIMIT 1
) AS survivor ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS source_count,
    bool_and(deliverable.applicability = 'not_applicable') AS all_not_applicable,
    bool_and(deliverable.status = 'completed') FILTER (WHERE deliverable.applicability = 'applicable') AS all_applicable_completed,
    bool_or(deliverable.status IN ('in_progress', 'completed')) FILTER (WHERE deliverable.applicability = 'applicable') AS any_applicable_progress,
    string_agg(DISTINCT deliverable.applicability_justification, '; ') FILTER (WHERE deliverable.applicability_justification IS NOT NULL) AS combined_justification
  FROM deliverable
  WHERE deliverable.gate_id = gate.id
    AND deliverable.template_id = ANY(target.source_template_ids)
) AS aggregate ON true;

-- Remove duplicate source records only after calculating conservative merged state.
DELETE FROM deliverable AS deliverable
USING methodology_015_resolution AS resolution
WHERE deliverable.gate_id = resolution.gate_id
  AND deliverable.template_id = ANY(resolution.source_template_ids)
  AND deliverable.id IS DISTINCT FROM resolution.survivor_id;

UPDATE deliverable AS deliverable
SET template_id = resolution.template_id,
    template_version = resolution.template_version,
    title = resolution.title,
    description = resolution.description,
    status = CASE
      WHEN resolution.all_not_applicable THEN resolution.survivor_status
      WHEN resolution.all_applicable_completed THEN 'completed'
      WHEN resolution.any_applicable_progress THEN 'in_progress'
      ELSE 'not_started'
    END,
    applicability = CASE WHEN resolution.all_not_applicable THEN 'not_applicable' ELSE 'applicable' END,
    applicability_justification = CASE WHEN resolution.all_not_applicable THEN coalesce(resolution.survivor_justification, resolution.combined_justification) ELSE NULL END,
    applicability_locked = resolution.applicability_locked,
    updated_at = now()
FROM methodology_015_resolution AS resolution
WHERE deliverable.id = resolution.survivor_id;

-- The former internal archive default has no direct replacement. Preserve it and
-- its status as a custom Deliverable rather than deleting operational data.
UPDATE deliverable
SET template_id = NULL, template_version = NULL, updated_at = now()
FROM gate
WHERE gate.id = deliverable.gate_id
  AND gate.status IN ('not_submitted', 'returned_for_rework')
  AND deliverable.template_id = 'internal_project_archive';

-- Mandatory Applicability Matrix controls remain Applicable and locked.
UPDATE deliverable
SET applicability = 'applicable', applicability_justification = NULL,
    applicability_locked = true, updated_at = now()
FROM gate
WHERE gate.id = deliverable.gate_id
  AND gate.status IN ('not_submitted', 'returned_for_rework')
  AND deliverable.template_id IN (
  'project_stage_gate_applicability_matrix',
  'package_stage_gate_applicability_matrix'
);

-- Do not add new incomplete requirements to Gates with an existing approved decision.
INSERT INTO deliverable (
  id, template_id, template_version, project_id, package_id, gate_id, sequence,
  title, description, status, stage_id, scope_level, created_at, updated_at,
  applicability, applicability_origin, applicability_locked
)
SELECT gate.id || ':deliverable:' || target.template_id, target.template_id,
  target.template_version, gate.project_id, gate.package_id, gate.id,
  coalesce((SELECT max(sequence) FROM deliverable WHERE gate_id = gate.id), 0) + target.sequence,
  target.title, target.description, 'not_started', gate.stage_id, gate.scope_level,
  now(), now(), 'applicable', 'template', target.applicability_locked
FROM methodology_015_target AS target
JOIN gate ON gate.scope_level = target.scope_level AND gate.stage_id = target.stage_id
WHERE gate.status IN ('not_submitted', 'returned_for_rework')
  AND NOT EXISTS (
    SELECT 1 FROM deliverable
    WHERE deliverable.gate_id = gate.id AND deliverable.template_id = target.template_id
  );

-- Restore deterministic default ordering while retaining every custom Deliverable.
UPDATE deliverable
SET sequence = deliverable.sequence + 10000
FROM gate
WHERE gate.id = deliverable.gate_id
  AND gate.status IN ('not_submitted', 'returned_for_rework');
WITH ordered AS (
  SELECT deliverable.id, row_number() OVER (
    PARTITION BY deliverable.gate_id
    ORDER BY coalesce(target.sequence, 1000), deliverable.sequence, deliverable.id
  ) AS sequence
  FROM deliverable
  JOIN gate ON gate.id = deliverable.gate_id
    AND gate.status IN ('not_submitted', 'returned_for_rework')
  LEFT JOIN methodology_015_target AS target
    ON target.scope_level = gate.scope_level
   AND target.stage_id = gate.stage_id
   AND target.template_id = deliverable.template_id
)
UPDATE deliverable
SET sequence = ordered.sequence
FROM ordered
WHERE deliverable.id = ordered.id;

UPDATE gate
SET template_version = 6
WHERE status IN ('not_submitted', 'returned_for_rework');

COMMENT ON TABLE gate_criterion IS 'Legacy inactive Gate Criteria retained by migration 015 for historical compatibility and recovery. The active application is Deliverables-only.';
COMMENT ON TABLE deliverable_criterion IS 'Legacy inactive Criterion-to-Deliverable links retained by migration 015 for historical compatibility, custom Criterion conversion traceability and recovery.';
