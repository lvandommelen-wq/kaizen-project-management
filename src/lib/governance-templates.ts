import type { GateDefinition } from "./gates";
import type { PackageStageId } from "./packages";
import type { ProjectStageId } from "./projects";

export const governanceTemplateVersion = 6;
const projectBaselineTemplateVersion = 7;

export type DeliverableTemplateDefinition = {
  id: string;
  title: string;
  previousTitles?: readonly string[];
  description: string;
  applicabilityLocked?: boolean;
};

export type GovernanceGateTemplate<StageId extends string> = GateDefinition<StageId> & {
  deliverables: DeliverableTemplateDefinition[];
};

const deliverable = (
  id: string,
  title: string,
  description: string,
  applicabilityLocked = false,
  previousTitles?: readonly string[],
): DeliverableTemplateDefinition => ({
  id,
  title,
  previousTitles,
  description,
  applicabilityLocked,
});

export const projectGateTemplates: GovernanceGateTemplate<ProjectStageId>[] = [
  {
    id: "project_authorization",
    templateVersion: governanceTemplateVersion,
    name: "Project Authorization",
    stageId: "initiation",
    deliverables: [
      deliverable("project_charter", "Project Charter / Project Brief / One-pager", "Accepted when it defines the business need, objectives, expected benefits, initial organization, key stakeholders, initial Risks, material Decisions and their justification at a level sufficient to authorize further Project definition."),
      deliverable("preliminary_project_scope", "Preliminary Project Scope", "Accepted when the initial Scope, boundaries, major assumptions, exclusions and expected outcomes are documented and sufficiently clear for authorization."),
      deliverable("initial_budget", "Initial Budget", "Accepted when an initial Cost estimate, principal assumptions, expected funding need and material uncertainty are documented and aligned with the current preliminary Scope."),
      deliverable("initial_master_schedule", "Initial Master Schedule / Milestone Plan", "Accepted when the required completion date, principal milestones, major dependencies and initial Schedule assumptions are documented."),
      deliverable("initial_project_raci", "Initial Project RACI", "Accepted when the Project Manager, initial Project organization and key responsibilities and accountabilities are identified."),
      deliverable("business_case_roi", "Business Case / ROI — where applicable", "Accepted when the investment rationale, expected benefits, material assumptions and available financial evaluation are documented and the Project remains justified."),
      deliverable("project_stage_gate_applicability_matrix", "Project Stage-Gate Deliverable Applicability Matrix", "Accepted when every default and custom Project Deliverable across the active lifecycle has an Applicable or justified Not Applicable decision. The generated matrix is frozen with the Project Authorization Review Cycle.", true, ["Project Stage-Gate Applicability Matrix"]),
    ],
  },
  {
    id: "project_baseline_approval",
    templateVersion: projectBaselineTemplateVersion,
    name: "Project Baseline Approval",
    stageId: "definition_design",
    deliverables: [
      deliverable("approved_project_scope", "Approved Project Scope", "Accepted when the overall Scope, boundaries, assumptions, exclusions, principal outputs and acceptance basis are defined and ready for formal baseline approval."),
      deliverable("approved_overall_requirements", "Approved URS / Overall Requirements", "Accepted when overall user and Project requirements are complete enough for Package definition, verification planning and formal approval, with material conflicts or gaps resolved or controlled."),
      deliverable("project_maintenance_reliability_strategy", "Project Maintenance & Reliability Strategy", "Accepted when the Project-wide reliability methodology, criticality approach, CMMS/EAM standards, maintenance responsibilities, supplier requirements and operational handover expectations are defined and approved where applicable."),
      deliverable("production_integration_master_data_strategy", "Production Integration & Master Data Strategy", "Accepted when the ERP/MES integration architecture, system responsibilities, master-data ownership, production-order handling, BOM/recipe requirements, material and traceability flows, Interfaces and handover responsibilities are defined."),
      deliverable("project_training_qualification_requirements_matrix", "Project Training & Qualification Requirements Matrix", "Accepted when the required operator, maintenance and other role-based training, competency, qualification and authorization requirements are defined and allocated to the Packages that must satisfy them during Execution."),
      deliverable("concept_basic_design", "Concept / Basic Design", "Accepted when the selected concept and basic design are sufficiently mature to support the Scope, Package breakdown, baseline and subsequent detailed execution."),
      deliverable("master_layout", "Master Layout", "Accepted when the Master Layout is approved at the required maturity and material spatial, operational, safety and Package-interface constraints are represented."),
      deliverable("package_breakdown_scope_structure", "Package Breakdown / Scope Structure", "Accepted when the Project Scope is divided into coherent Packages with clear boundaries, ownership and an execution approach appropriate to the current maturity."),
      deliverable("project_budget_baseline_ready", "Project Budget Baseline", "Accepted when the Cost baseline is complete, internally consistent, aligned with Scope and Schedule, and ready for formal approval."),
      deliverable("master_schedule_baseline_ready", "Master Schedule Baseline", "Accepted when the integrated Schedule baseline includes the required milestones, dependencies and Package interfaces and is ready for formal approval."),
      deliverable("project_governance_escalation_plan", "Project Governance, RACI & Escalation Plan", "Accepted when Project responsibilities, Decision authority, Governance Tiers, meeting structure, escalation paths, participants, reviewed registers and escalation triggers are defined."),
      deliverable("project_site_organization_ehs_plan", "Project Site Organization & EHS Plan", "Accepted when a proportionate Project-wide plan defines the applicable site organization, access, logistics, storage, traffic management, EHS responsibilities, supervision, escalation, permit-to-work, LOTO and energy isolation, contractor onboarding, risk prevention, SIMOPS, lifting, emergency response, incident reporting, PPE, housekeeping, waste, environmental and construction-site safety coordination requirements for relevant Packages, contractors and subcontractors."),
      deliverable("procurement_execution_strategy", "Procurement / Execution Strategy", "Accepted when the intended procurement and execution approaches, contracting assumptions, internal-versus-external considerations and major sequencing decisions are documented."),
      deliverable("initial_interface_structure", "Interface Definition / Initial Interface Structure", "Accepted when major Project and Package boundaries and Interfaces are identified, assigned and placed under an appropriate living Interface-control structure."),
      deliverable("validation_strategy_plan", "Validation Strategy / Plan — where applicable", "Accepted when the Validation scope, responsibilities, approach, required qualification activities, evidence and release path are defined, or the Deliverable is justified Not Applicable."),
      deliverable("initial_traceability_structure", "Initial RTM / Traceability Structure", "Accepted when a usable requirements traceability structure is established, requirements are assigned to appropriate verification routes and ownership for maintaining traceability is defined."),
      deliverable("project_risk_issue_assessment", "Project Risk & Issue Assessment", "Accepted when material Project Risks and Issues have been assessed, responses or owners assigned, and the Deliverable references the current living Risk and Issue registers rather than duplicating them."),
      deliverable("updated_business_case_investment_justification", "Updated Business Case / Investment Justification", "Accepted when the investment remains justified against the developed Scope, Cost, Schedule, benefits and material Risks, and significant changes from authorization are explained."),
    ],
  },
  {
    id: "project_delivery_complete",
    templateVersion: governanceTemplateVersion,
    name: "Project Delivery Complete",
    stageId: "delivery",
    deliverables: [
      deliverable("package_handover_records", "Package Handover Records", "Accepted when all required Packages have reached their required handover or completion state and their approved handover evidence is available for Project review."),
      deliverable("maintenance_reliability_readiness_overview", "Maintenance & Reliability Readiness Overview", "Accepted when maintenance readiness is consolidated across applicable Packages, including maintenance strategies, spare parts, support, training and outstanding critical items, with unresolved items controlled or formally accepted."),
      deliverable("cmms_eam_integration_verification", "CMMS / EAM Integration & Verification", "Accepted when applicable Package asset and maintenance data have been consolidated, integrated into the receiving CMMS/EAM environment and verified for completeness and correct implementation."),
      deliverable("production_readiness_integration_overview", "Production Readiness & Integration Overview", "Accepted when production readiness across Packages is consolidated, cross-Package Interfaces are resolved, operational procedures and training are complete, and outstanding integration items are controlled and accepted by the receiving organization."),
      deliverable("production_master_data_integration_verification", "Production Master Data Integration & Verification", "Accepted when applicable Package production master-data inputs have been consolidated, integrated into the receiving ERP/MES environment and verified for completeness and correct implementation."),
      deliverable("integrated_sat_evidence", "Integrated SAT / System Test Evidence — where applicable", "Accepted when required integrated or system-level tests are completed against approved requirements, results and deviations are documented, and duplicate Package testing is avoided by reusing valid evidence."),
      deliverable("integrated_system_safety_release_checklist", "Integrated Line / System Safety Release Checklist", "Accepted when cross-Package safety Interfaces and overall integrated-system readiness have been reviewed, blocking safety issues are resolved and the system is authorized for the intended next activity where applicable."),
      deliverable("updated_master_layout", "Updated Master Layout / appropriate as-built maturity", "Accepted when the Master Layout reflects the delivered installation at the maturity required for handover, Validation or Closure and material deviations are controlled."),
      deliverable("handover_documentation", "Handover Documentation", "Accepted when the required operating, maintenance, engineering and handover documentation is available, controlled and transferred to the responsible receiving parties."),
      deliverable("training_documentation", "Training Documentation", "Accepted when required Project-level and Package-derived training and qualification evidence is complete, traceable to the approved requirements and available to the receiving organization."),
      deliverable("snag_overview", "Outstanding Items / SNAG / Risk & Issue Disposition", "Accepted when critical blocking items are closed and every remaining non-critical SNAG, Action, Risk or Issue is documented, owned, due-dated and formally accepted or transferred."),
      deliverable("updated_verification_evidence", "Updated RTM / Verification Evidence", "Accepted when the RTM is current, requirements applicable to Delivery have appropriate verification evidence, and unresolved gaps or approved Changes are clearly dispositioned."),
    ],
  },
  {
    id: "validation_complete",
    templateVersion: governanceTemplateVersion,
    name: "Validation Complete",
    stageId: "validation",
    deliverables: [
      deliverable("iq_protocol_report", "IQ Protocol and Report", "Accepted when applicable installation qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision."),
      deliverable("oq_protocol_report", "OQ Protocol and Report", "Accepted when applicable operational qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision."),
      deliverable("pq_protocol_report", "PQ Protocol and Report", "Accepted when applicable performance qualification activities are approved, executed and reported, with deviations controlled; otherwise it requires a justified Not Applicable decision."),
      deliverable("validation_deviation_documentation", "Validation Deviation Documentation", "Accepted when Validation deviations are documented, assessed and closed or formally dispositioned without invalidating approved qualification evidence."),
      deliverable("final_rtm", "Final RTM / Validation Traceability Evidence", "Accepted when requirements traceability is complete, critical requirements have appropriate Verification or Validation evidence and the effect of applicable Changes is accounted for."),
      deliverable("validation_summary_report", "Validation Summary Report", "Accepted when the completed Validation scope, results, deviations, residual Risks and conclusion are summarized and approved."),
      deliverable("formal_release_evidence", "Formal Release / Approval Evidence — where applicable", "Accepted when the required system or process release is formally recorded by the authorized parties, or the Deliverable is justified Not Applicable."),
    ],
  },
  {
    id: "project_closed",
    templateVersion: governanceTemplateVersion,
    name: "Project Closed",
    stageId: "closure",
    deliverables: [
      deliverable("final_as_built_scope", "Final / As-Built Project Scope", "Accepted when the final delivered Scope and material approved deviations are documented and reconciled to the current approved state."),
      deliverable("final_master_layout", "Final Master Layout", "Accepted when the controlled final Master Layout accurately represents the as-built Project state."),
      deliverable("final_budget_cost_report", "Final Budget / Cost Report", "Accepted when the final Cost position, commitments, actuals, approved Changes, remaining obligations and material variance explanations are established."),
      deliverable("final_schedule_performance_report", "Final Schedule Performance Report", "Accepted when final milestone and Schedule performance, material variance and relevant causes are documented."),
      deliverable("final_rtm", "Final RTM", "Accepted when final requirements traceability and the disposition of Verification, Validation and approved Change evidence are complete."),
      deliverable("final_handover_record", "Final Project Handover & Acceptance Record", "Accepted when a formal checklist identifies required handover Deliverables, outstanding obligations, responsible owners and receiving-party acceptance without duplicating signatures already provided by the Gate approval."),
      deliverable("project_evaluation", "Project Post-Mortem / Evaluation", "Accepted when Project performance, outcomes, Lessons Learned and improvement opportunities are evaluated and material follow-up is assigned."),
      deliverable("customer_handover_package", "Customer As-Built Handover Package", "Accepted when the required final customer-facing as-built documentation package is complete, controlled and transferred."),
    ],
  },
];

export const packageGateTemplates: GovernanceGateTemplate<PackageStageId>[] = [
  {
    id: "definition_complete",
    templateVersion: governanceTemplateVersion,
    name: "Definition Complete",
    previousNames: ["Definition Complete / Ready for Execution Strategy"],
    stageId: "definition",
    deliverables: [
      deliverable("package_scope", "Package Scope & Interface Definition", "Accepted when Package Scope, boundaries, assumptions, exclusions, responsibilities and material Project, Package and external Interfaces are defined and assigned."),
      deliverable("package_requirements", "Package Requirements", "Accepted when applicable functional, technical, performance, safety, Interface, documentation, FAT/SAT and acceptance requirements are sufficiently complete for supplier-facing tendering or internally executed detailed engineering."),
      deliverable("maintenance_reliability_requirements", "Maintenance & Reliability Requirements", "Accepted when maintainability, reliability, applicable analysis depth, CMMS/EAM data, spare-parts, training, support and responsibility requirements are defined."),
      deliverable("production_integration_requirements", "Production Integration Requirements", "Accepted when applicable production-order, BOM/recipe, material identification and consumption, traceability, equipment-to-ERP/MES, automation and master-data responsibilities are defined."),
      deliverable("package_raci", "Package RACI / Package Organization", "Accepted when the Package owner, execution organization, responsibilities, accountabilities and material stakeholder roles are defined."),
      deliverable("package_milestone_requirements", "Package Milestone Requirements", "Accepted when required delivery dates, key milestones, dependencies and Schedule Interfaces are defined and aligned with the Master Schedule."),
      deliverable("preliminary_internal_resource_estimate", "Preliminary Internal Resource Estimate — where applicable", "Accepted when preliminary internal discipline, capacity and timing needs are estimated where internal execution remains an option, or the Deliverable is justified Not Applicable."),
      deliverable("package_stage_gate_applicability_matrix", "Package Stage-Gate Deliverable Applicability Matrix", "Accepted when every default and custom Package Deliverable across the configured lifecycle has an Applicable or justified Not Applicable decision. The generated matrix is frozen with the Package Definition Complete Review Cycle.", true),
      deliverable("package_risk_assessment", "Package Risk Assessment", "Accepted when material Package Risks are assessed, responses and owners are assigned, and the assessment references the living Risk register rather than duplicating it."),
    ],
  },
  {
    id: "execution_strategy_selection",
    templateVersion: governanceTemplateVersion,
    name: "Execution Model & Technical Selection",
    previousNames: ["Execution Strategy Selection"],
    stageId: "tendering",
    deliverables: [
      deliverable("rfq_tender_package", "RFQ / Tender Package", "Accepted when approved Package Requirements are translated into a complete supplier-facing request including Scope, Interfaces, deliverables, commercial instructions and evaluation basis."),
      deliverable("supplier_proposals", "Supplier Proposal(s) — where applicable", "Accepted when the required supplier proposals and material clarifications are received, controlled and suitable for evaluation, or the Deliverable is justified Not Applicable."),
      deliverable("technical_evaluation", "Technical Evaluation / TECO — where applicable", "Accepted when technical compliance, deviations, performance, safety, Interfaces, documentation, FAT/SAT, production integration and acceptance requirements are evaluated and material gaps are resolved or controlled."),
      deliverable("maintenance_reliability_evaluation", "Maintenance & Reliability Evaluation", "Accepted when external or internal proposals are evaluated for maintainability, reliability, lifecycle Cost, spare parts, maintenance support and training against approved requirements."),
      deliverable("internal_execution_proposal", "Internal Execution Proposal — where applicable", "Accepted when the internal solution, Scope, approach, responsibilities, assumptions, Cost, Schedule and Risks are defined sufficiently for comparison, or the Deliverable is justified Not Applicable."),
      deliverable("internal_resource_estimate", "Internal Resource Estimate — where applicable", "Accepted when required internal disciplines, effort, capacity and timing are sufficiently estimated for the Decision, or the Deliverable is justified Not Applicable."),
      deliverable("make_or_buy_recommendation", "Execution Model & Technical Selection Recommendation and Decision Record", "Accepted when technical evaluation, internal-versus-external feasibility, Cost and Schedule implications, Risks, major Interfaces, the recommended Execution Model and the formal Decision are recorded without duplicating Gate approvals."),
    ],
  },
  {
    id: "contract_award",
    templateVersion: governanceTemplateVersion,
    name: "Contract Award",
    stageId: "procurement",
    deliverables: [
      deliverable("commercial_recommendation", "Commercial Evaluation & Award Recommendation", "Accepted when proposals are commercially compared, the negotiated position and Budget alignment are established, contractual Risks are understood and the supplier award recommendation is documented."),
      deliverable("contract_cnd", "Contract / CND", "Accepted when the contractual instrument defines the agreed Scope, Interfaces, responsibilities, Schedule, deliverables, acceptance basis and applicable commercial terms, or is justified Not Applicable."),
      deliverable("cca_loi", "CCA / LOI — where applicable", "Accepted when any required conditional commitment or letter of intent is authorized, controlled and aligned with the intended award, or the Deliverable is justified Not Applicable."),
      deliverable("purchase_order", "Purchase Order", "Accepted when the authorized Purchase Order accurately reflects the approved supplier, value, contractual reference and required commercial commitment, or is justified Not Applicable under the configured execution route."),
    ],
  },
  {
    id: "package_handover",
    templateVersion: governanceTemplateVersion,
    name: "Package Handover / Execution Complete",
    stageId: "execution",
    deliverables: [
      deliverable("approved_design_documentation", "Approved Design Documentation", "Accepted when required design outputs and reviews are complete, controlled and approved at the maturity required for implementation and handover."),
      deliverable("fat_protocol_report", "FAT Protocol / Report — where applicable", "Accepted when applicable FAT scope and acceptance criteria are approved, testing is completed and results, deviations and disposition are documented, or the Deliverable is justified Not Applicable."),
      deliverable("installation_documentation", "Installation Documentation — where applicable", "Accepted when applicable installation plans, records, checks and deviations demonstrate completion to approved requirements, or the Deliverable is justified Not Applicable."),
      deliverable("commissioning_documentation", "Commissioning Documentation — where applicable", "Accepted when applicable commissioning plans, controlled test-operation arrangements, records, results and deviations demonstrate readiness for intended use or the next activity."),
      deliverable("sat_protocol_report", "SAT Protocol / Report — where applicable", "Accepted when applicable SAT or verification scope is approved, executed against Package Requirements and results and deviations are documented, or the Deliverable is justified Not Applicable."),
      deliverable("maintenance_strategy_reliability_assessment", "Maintenance Strategy & Reliability Assessment", "Accepted when the reactive, preventive, predictive or condition-based and failure-finding strategy is approved and supported by the required criticality and reliability analyses at a depth appropriate to the Package."),
      deliverable("cmms_eam_master_data_handover", "CMMS / EAM Master Data Input Handover", "Accepted when complete equipment-specific asset hierarchy, functional-location, equipment, BOM, task-list, maintenance-plan and counter inputs are prepared, quality-checked and handed over for Project-level integration."),
      deliverable("maintenance_support_spare_parts_plan", "Maintenance Support, Spare Parts & Spares Information", "Accepted when critical and recommended spare parts, availability, OEM/SLA support, responsibilities and intervention and escalation arrangements are documented and handed over."),
      deliverable("training_qualification_matrix", "Package Training & Qualification Evidence", "Accepted when Package obligations from the Project Training & Qualification Requirements Matrix are satisfied and operator and maintenance training, competency, qualification and intervention authorization evidence is complete."),
      deliverable("production_master_data_handover", "Production Master Data Input Handover", "Accepted when complete equipment-specific production BOM, work-center, routing, recipe, material, production-version and other required ERP/MES master-data inputs are prepared, quality-checked and handed over for Project-level integration."),
      deliverable("production_interface_integration_verification", "Production Interface & Integration Verification", "Accepted when applicable production-order, recipe or parameter, material, confirmation, traceability and ERP/MES/equipment data exchanges, including failure and recovery behavior, are verified using existing FAT/SAT evidence where appropriate."),
      deliverable("production_operational_readiness_training", "Production Operational Readiness & Training", "Accepted when operating procedures, operator training and qualification, production responsibilities, master-data readiness and outstanding production issues are controlled and the receiving Production organization is ready."),
      deliverable("manuals", "Manuals", "Accepted when required operating, maintenance, engineering and supplier manuals are complete, controlled, usable and transferred to the responsible receiving parties."),
      deliverable("snag_punch_list", "SNAG / Punch List", "Accepted when critical SNAGs are closed and every remaining item is documented, classified, owned, due-dated and formally accepted for follow-up."),
      deliverable("equipment_safety_commissioning_release_checklist", "Equipment Safety & Commissioning Release Checklist (Indienststelling)", "Accepted before intended use when applicable EHS review, safety documentation, CE conformity, Risk assessment, safeguarding, emergency stops, LOTO and authorization for use are complete, while preserving controlled commissioning or test-operation arrangements."),
      deliverable("handover_record", "Handover & Provisional Acceptance Record", "Accepted when the receiving organization formally acknowledges the Package handover state, accepted outstanding obligations, ownership and any applicable provisional acceptance without duplicating Gate approval signatures."),
      deliverable("updated_as_built_documentation", "As-Built Documentation", "Accepted when required drawings, software, settings, design records and other controlled documentation accurately represent the installed Package at the required final maturity.", false, ["Updated / As-Built Documentation"]),
    ],
  },
  {
    id: "package_closed",
    templateVersion: governanceTemplateVersion,
    name: "Package Closed",
    stageId: "closure",
    deliverables: [
      deliverable("final_as_built_package", "Final As-Built Package", "Accepted when the final controlled Package documentation is complete, represents the delivered state and is ready for Project and customer handover."),
      deliverable("final_package_cost_summary", "Final Package Cost Summary", "Accepted when the final Package Cost position, commitments, actuals, approved Changes, remaining obligations and material variance are established from the Project Cost records."),
      deliverable("final_acceptance_documentation", "Final Acceptance Documentation — where applicable", "Accepted when applicable final acceptance conditions and supplier obligations are satisfied and formally documented, or the Deliverable is justified Not Applicable."),
      deliverable("warranty_documentation", "Warranty Documentation — where applicable", "Accepted when applicable warranty terms, dates, conditions, contacts, exclusions and follow-up ownership are documented and transferred, or the Deliverable is justified Not Applicable."),
      deliverable("package_lessons_learned", "Package Post-Mortem", "Accepted when supplier or internal execution performance, outcomes, Lessons Learned and improvement opportunities are evaluated and material follow-up is assigned."),
    ],
  },
];

export function getProjectGateTemplates(validationRequired: boolean) {
  return projectGateTemplates.filter((template) => validationRequired || template.stageId !== "validation");
}
