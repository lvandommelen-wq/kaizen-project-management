# CAPEX Project Management Application

## Global Product Requirements

# 1. Purpose

Create a web-based Project Management application for managing technical CAPEX Projects from Initiation until final handover, archiving and Closure.

The application is intended for Projects involving:

* technical equipment;
* engineering;
* automation;
* installation;
* commissioning;
* qualification/Validation where applicable.

Typical industries include:

* pharmaceutical manufacturing;
* food & beverage;
* machine manufacturing;
* industrial production.

The application follows a waterfall / Stage-Gate Project Management philosophy while recognizing that a single CAPEX Project normally contains multiple Packages that progress independently through their own lifecycles.

The application should act as the main Project Management interface while integrating with specialized systems where appropriate.

In particular:

* the CAPEX application manages structured Project Management information and governance;
* SharePoint manages Project and Package files/Documents;
* Microsoft Project may manage detailed Project scheduling.

The objective is not to recreate these specialized systems inside the application, but to provide one integrated Project Management interface across them.

---

# 2. Execution Model

The decision whether work is executed Internally or Externally belongs primarily at **Package level**, not Project level.

A single Project may contain both Internally and Externally executed Packages.

Example:

Project — New Production Line

* PKG-001 Filling Machine → External
* PKG-002 Conveyors → External
* PKG-003 Electrical Engineering → Internal
* PKG-004 Automation → Internal
* PKG-005 Civil Works → External

The Project itself should therefore NOT be classified as:

* Supplier-led;
* Internally executed.

Instead, each Package may receive an **Execution Model**.

There are only two Execution Models:

* External
* Internal

Before the execution decision has been made, the Execution Model may remain unset / not yet determined.

`Not determined` is not a third Execution Model. It represents the absence of an approved Internal/External decision.

The execution decision may be made:

* during Package Definition; or
* during Package Tendering.

This allows the application to support make-or-buy decisions as part of normal CAPEX Project execution.

---

# 3. Core Philosophy

The application should provide one structured source of truth for Project execution.

It should replace or consolidate Project Management information currently distributed across tools such as:

* Excel Action lists;
* Budget trackers;
* Risk Registers;
* Issue lists;
* Change Registers;
* Decision Logs;
* Interface lists;
* Deliverable lists;
* meeting follow-up;
* Project Dashboards;
* Stage-Gate checklists;
* reporting templates;
* traceability matrices.

The application should remain lean.

It is NOT intended to become:

* a generic ERP system;
* a full Document Management System;
* an engineering design system;
* a full detailed scheduling engine;
* a replacement for specialized Validation or engineering tools where these remain necessary;
* an HR system.

The application should structure and connect Project information rather than duplicate information unnecessarily.

A fundamental principle is:

> One source of truth, multiple controlled views.

Information should be stored once and filtered, referenced or displayed differently depending on:

* Project context;
* Package context;
* Governance Tier;
* Visibility;
* user permissions.

---

# 4. System-of-Record Architecture

The overall solution should deliberately separate responsibilities between systems.

## 4.1 CAPEX Project Management Application

The application is the system of record for structured Project Management information.

Examples include:

* Projects;
* Packages;
* suppliers;
* stakeholders;
* Resources;
* Resource Plans;
* Governance Tiers;
* Stages;
* Gates;
* Deliverables;
* Actions;
* Risks;
* Issues;
* Changes;
* Decisions;
* Interfaces;
* Requirements;
* Requirements Traceability;
* Budget information;
* milestones;
* permissions configuration;
* Document metadata and relationships;
* audit/history information.

## 4.2 SharePoint

SharePoint is the primary Document Management and file-storage backend.

Actual Project files should primarily be stored in SharePoint.

Examples include:

* Scope Documents;
* URS Documents;
* Technical Specifications;
* drawings;
* Layouts;
* supplier quotations;
* contracts;
* design documentation;
* FAT Protocols;
* FAT Reports;
* SAT Protocols;
* SAT Reports;
* manuals;
* certificates;
* training documentation;
* software documentation;
* as-built documentation;
* Validation documentation.

The CAPEX application should provide the main user interface through which users navigate, create, update, relate and access these Documents wherever practical.

## 4.3 Microsoft Project

Microsoft Project may act as the detailed planning/scheduling system.

The CAPEX application should manage:

* Project Schedule governance;
* key milestones;
* Package milestones;
* Schedule status;
* Gate dates;
* Schedule reporting.

Detailed scheduling may remain in Microsoft Project.

## 4.4 Architectural Principle

Conceptually:

CAPEX PM Application
→ Project governance and structured data

SharePoint
→ Documents and files

Microsoft Project
→ Detailed scheduling

The application should integrate these systems without unnecessarily duplicating their functionality.

---

# 5. Core Information Architecture

The main hierarchy should conceptually follow:

Portfolio
→ Project
→ Package

Packages may then connect to:

* external suppliers; or
* internal Resources.

Conceptually:

Project
├── Project Governance
│   ├── Project Lifecycle
│   ├── Project Gates
│   └── Governance Tiers
│
├── Project Controls
│   ├── Scope
│   ├── Cost / Budget
│   ├── Master Schedule
│   ├── Risk
│   └── Change
│
├── Master Registers
│   ├── Actions
│   ├── Risks
│   ├── Issues
│   ├── Changes
│   ├── Decisions
│   └── Interfaces
│
├── Requirements & Verification
│   ├── Requirements / URS
│   ├── Design References
│   ├── Verification / Testing
│   └── Traceability
│
├── Project Documents → SharePoint
│
└── Packages
├── Execution Model
├── Package Lifecycle
├── Package Gates
├── Package Deliverables
├── Package Documents → SharePoint
├── Package Requirements
├── Package Milestones
├── Budget relationships
├── Tender Candidates
├── Awarded Supplier — if External
└── Resource Plan — if Internal

A Project is the master container.

Packages are child Scopes within the Project.

A Package is NOT the same entity as a Supplier.

A Supplier is NOT the same entity as a Package.

A Resource is NOT the same entity as a Package.

---

# 6. Scope Level

Application objects may exist at different Scope levels.

At minimum:

* PROJECT
* PACKAGE

Project-level objects apply to the overall Project.

Package-level objects apply to one or more Packages.

The architecture must not assume that every object belongs to exactly one Package.

Where appropriate, an object may be associated with:

* no Package;
* one Package;
* multiple Packages.

Examples:

An overall plant Layout may be Project-level and referenced by several Packages.

Actions are a deliberate exception: an Action is either Overall Project scoped or associated with exactly one Package, never multiple Packages.

A Requirement may require implementation or Verification across several Packages.

Package association, Visibility and Governance Tier are separate concepts.

They answer three different questions:

* Package association: What Scope does this concern?
* Visibility: Who may see this information?
* Governance Tier: At what level is this information currently managed or escalated?

These concepts should remain independent in the data model.

---

# 7. Projects

A Project is the primary container.

Typical Project information:

* Project number
* Project name
* Description
* Customer
* Project Manager
* Reports To
* Sponsor
* Business owner
* Site/location
* Department
* Business unit
* Planned start date
* Planned completion date
* Current Project Stage
* Validation required: Yes / No
* Project status indicators
* Project team

Do NOT classify a Project as Internal or External.

Execution responsibility is determined at Package level.

Do not assume one Main Supplier/OEM at Project level.

Suppliers should primarily be linked through Packages.

A Project may simultaneously contain:

* Internal Packages;
* External Packages;
* Packages for which the Internal/External execution decision has not yet been made.

Creating a Project should eventually be capable of provisioning the corresponding SharePoint Project environment automatically.

---

# 8. Project Lifecycle

The overall Project lifecycle represents Project governance and integration.

Default CAPEX Project lifecycle:

1. Initiation
2. Definition & Design
3. Delivery
4. Validation — optional
5. Closure

If Validation is not required:

Initiation
→ Definition & Design
→ Delivery
→ Closure

If Validation is required:

Initiation
→ Definition & Design
→ Delivery
→ Validation
→ Closure

Validation should be configurable when creating the Project.

A newly created Project starts in Initiation.

During Initiation, the Project Manager must complete a Project Applicability Review covering all Project-level Deliverables across the active Project lifecycle. The review must use the Project-specific Gate records instantiated from the standard templates, must exclude the Validation Stage when Validation is not required, and must remain accessible throughout the Project lifecycle.

The review creates a tailored Project methodology without modifying the master templates or any other Project. Each item must have one authoritative applicability value: Applicable or Not Applicable. Applicable is the default for all default and custom items. Not Applicable requires a justification for new decisions. Applicability is separate from completion status.

Tendering, Procurement, FAT, Installation, Commissioning and similar Package activities should NOT normally be modeled as overall Project Stages because different Packages may perform these activities at different times.

The exact lifecycle should eventually be configurable.

Do not unnecessarily hard-code business logic to exact Stage names.

Stable internal identifiers should be used for lifecycle entities.

---

# 9. Project Stages and Gates

The Project methodology contains exactly 52 default Deliverables. Every default Deliverable has explicit acceptance requirements stored in its Deliverable description. Those requirements replace the former separate Gate Criteria checklist.

### Project Authorization — 7 Deliverables

1. Project Charter / Project Brief / One-pager
2. Preliminary Project Scope
3. Initial Budget
4. Initial Master Schedule / Milestone Plan
5. Initial Project RACI
6. Business Case / ROI — where applicable
7. Project Stage-Gate Deliverable Applicability Matrix

The Charter must include the business need, objectives, benefits, initial organization, stakeholders, Risks, material Decisions and their justification. The Applicability Matrix is a mandatory, locked methodology control.

### Project Baseline Approval — 18 Deliverables

1. Approved Project Scope
2. Approved URS / Overall Requirements
3. Project Maintenance & Reliability Strategy
4. Production Integration & Master Data Strategy
5. Project Training & Qualification Requirements Matrix
6. Concept / Basic Design
7. Master Layout
8. Package Breakdown / Scope Structure
9. Project Budget Baseline
10. Master Schedule Baseline
11. Project Governance, RACI & Escalation Plan
12. Project Site Organization & EHS Plan
13. Procurement / Execution Strategy
14. Interface Definition / Initial Interface Structure
15. Validation Strategy / Plan — where applicable
16. Initial RTM / Traceability Structure
17. Project Risk & Issue Assessment
18. Updated Business Case / Investment Justification

The RTM is Applicable by default whether or not formal Validation is required. The Training & Qualification Requirements Matrix defines requirements that Packages must satisfy during Execution. Risk and Issue Assessments reference the living registers rather than duplicating them. The Project Site Organization & EHS Plan defines the common Project-wide site and EHS arrangements inherited by relevant Packages, contractors and subcontractors.

#### Project Site Organization & EHS Plan

The **Project Site Organization & EHS Plan** (`project_site_organization_ehs_plan`) is a Project-level governance Deliverable at the Project Baseline Approval Gate. It is Applicable by default and must be proportionate to the Project Scope and applicable legislation. It establishes the overarching requirements for:

* site organization, access, logistics, storage and traffic management;
* EHS roles, responsibilities, supervision and escalation;
* permit-to-work policy, including hot work, working at height, confined spaces and electrical work where applicable;
* Lockout/Tagout and energy-isolation requirements;
* contractor onboarding, site induction and qualification;
* the Health & Safety Plan and Project-specific Risk prevention;
* SIMOPS and coordination of concurrent contractor and production activities;
* lifting operations, temporary equipment and exclusion zones;
* emergency arrangements and incident reporting;
* PPE, housekeeping, waste management and environmental requirements; and
* applicable construction-site legislation, safety coordination and H&S planning obligations.

This Deliverable does not create a separate EHS checklist module or duplicate Package-level EHS Deliverables.

### Project Delivery Complete — 12 Deliverables

1. Package Handover Records
2. Maintenance & Reliability Readiness Overview
3. CMMS / EAM Integration & Verification
4. Production Readiness & Integration Overview
5. Production Master Data Integration & Verification
6. Integrated SAT / System Test Evidence — where applicable
7. Integrated Line / System Safety Release Checklist
8. Updated Master Layout / appropriate as-built maturity
9. Handover Documentation
10. Training Documentation
11. Outstanding Items / SNAG / Risk & Issue Disposition
12. Updated RTM / Verification Evidence

Scope, Budget, Schedule and MOC information remains controlled through living Project records rather than a separate Delivery reconciliation Deliverable. Relevant reconciliation must be addressed by the acceptance requirements and formal Gate evidence. Project Delivery owns consolidated verification of CMMS/EAM and Production Master Data integration. The integrated safety release checklist covers cross-Package safety interfaces and overall integrated-system readiness where applicable.

### Validation Complete — 7 Deliverables

1. IQ Protocol and Report
2. OQ Protocol and Report
3. PQ Protocol and Report
4. Validation Deviation Documentation
5. Final RTM / Validation Traceability Evidence
6. Validation Summary Report
7. Formal Release / Approval Evidence — where applicable

The Validation Stage remains optional. Individual IQ, OQ and PQ Deliverables may be Not Applicable with justification. The Project RTM remains required even when the entire Validation Stage is excluded.

### Project Closed — 8 Deliverables

1. Final / As-Built Project Scope
2. Final Master Layout
3. Final Budget / Cost Report
4. Final Schedule Performance Report
5. Final RTM
6. Final Project Handover & Acceptance Record
7. Project Post-Mortem / Evaluation
8. Customer As-Built Handover Package

Lessons Learned form part of the Project Post-Mortem. The Customer As-Built Handover Package is a standard Applicable Deliverable. The Final Project Handover & Acceptance Record is supported by a checklist of required handover Deliverables, outstanding obligations, responsible owners and receiving-party acceptance; it must avoid duplicating signatures already supplied through the Gate approval workflow.

## 9.1 Initiation

Purpose:

Establish the business need, feasibility and initial Project definition.

Typical Deliverables/information:

* Business need / problem statement
* Project Charter / 1-pager
* Preliminary Scope
* Preliminary Budget
* Preliminary Schedule
* Business case / ROI where applicable
* Initial stakeholder identification
* Initial Risks
* Project organization

### Gate: Project Authorization

Purpose:

Authorize further Project definition and engineering.

Default Deliverable:

* **Project Stage-Gate Deliverable Applicability Matrix** — Generated from the structured Project applicability configuration. It identifies active Stages and Gates, default and custom Deliverables, applicability decisions and Not Applicable justifications. It must not be maintained as a separate spreadsheet. Its Deliverable title on the Project Authorization Gate provides the primary navigation to the existing Project Applicability Review while its completion status remains independently editable through Gate preparation.

Before Project Authorization may be submitted, every new Project-level Not Applicable decision across the active lifecycle must have a justification. Package-specific decisions are not required for Packages that do not yet exist.

The submitted Project Stage-Gate Deliverable Applicability Matrix must be frozen with the Project Authorization Review Cycle so that later tailoring cannot rewrite the approved methodology snapshot.

---

## 9.2 Definition & Design

Purpose:

Develop the overall Project sufficiently to establish the Project baseline and Package strategy.

Typical Project-level Deliverables/information:

* Overall Project Scope
* Overall URS / Requirements
* Concept / Basic Design
* Master Layout
* Project Execution Strategy
* Procurement Strategy
* Package breakdown
* Master Schedule
* Detailed Project Budget
* Project RACI
* Governance / escalation structure
* **Project Site Organization & EHS Plan** — Defines the common site organization, EHS responsibilities, safety rules and working procedures applicable across relevant Packages, contractors and subcontractors.
* Risk assessment
* Interface Register
* Validation Strategy / Plan where applicable
* Initial Requirements Traceability Matrix where applicable
* initial internal Resource demand where relevant
* **Project Maintenance & Reliability Strategy** — Defines the project-wide reliability methodology, applicable criticality assessments, CMMS/EAM standards, maintenance responsibilities, supplier requirements and operational handover expectations.
* **Production Integration & Master Data Strategy** — Defines the system-agnostic ERP/MES integration architecture and system responsibilities; production master-data ownership; production order handling; production BOM and recipe requirements; material consumption and inventory reporting; batch/lot traceability requirements; interfaces between production equipment, automation, MES and ERP; and master-data preparation and handover responsibilities.

Packages should normally be identified and created during this Stage.

### Gate: Project Baseline Approval

This Gate should establish the approved Project baseline.

Typical baselined Controls:

* Scope Baseline
* Cost Baseline
* Schedule Baseline

Relevant controlled Documents may also be formally approved at this Gate.

After baseline approval:

Original Baseline

* Approved Changes
  = Current Approved State

This principle should apply to Scope, Cost and Schedule.

The acceptance requirements of the applicable Definition & Design Deliverables cover maintenance and reliability, production integration and master-data responsibilities, baseline readiness, governance, site organization and EHS arrangements, interfaces, Risk and Issue assessment, traceability and investment justification.

---

## 9.3 Delivery

Purpose:

Coordinate and control the delivery of individual Packages and their integration into the overall Project.

Packages may be in different lifecycle Stages simultaneously.

Example:

* Package A: Closure
* Package B: Execution
* Package C: Procurement
* Package D: Tendering

The Project itself may remain in Delivery while these Packages progress independently.

Typical Project-level activities:

* Master Schedule management;
* overall Budget management;
* Project Change Control;
* Risk and Issue management;
* Interface Management;
* Master Layout management;
* cross-Package coordination;
* Governance Tier meetings;
* escalation management;
* Resource coordination;
* overall reporting;
* integration planning;
* overall Actions and Decisions.

Project-level Deliverables:

* **Maintenance & Reliability Readiness Overview** — Consolidates maintenance readiness across applicable Packages, including maintenance strategy, CMMS integration, spare parts, support and training.
* **Production Readiness & Integration Overview** — Consolidates production integration readiness across applicable Packages, including production master-data availability; production interface verification; production order and material-consumption functionality; traceability readiness; operational procedures and training; outstanding production integration issues; and acceptance by the receiving Production organization.

### Gate: Project Delivery Complete

This Gate confirms that the delivery activities required before Validation or Closure are sufficiently complete.

The acceptance requirements of the Project Delivery Complete Deliverables cover maintenance and reliability readiness, cross-Package integration, Delivery verification evidence, training and handover to Operations. Final Production acceptance remains part of the Project Handover / Acceptance process.

---

# 10. Validation — Optional

Validation is an optional CUSTOMER / PROJECT-level Stage.

It should not automatically be treated as a supplier/Package responsibility.

Typical qualification/Validation activities may include:

* IQ
* OQ
* PQ
* Validation deviations
* Final Requirements Traceability
* Validation Summary Report

Validation planning begins earlier in the Project even though qualification execution may occur during this later Stage.

Typical Deliverables:

* Validation Strategy / Plan
* Qualification Risk Assessment
* IQ Protocol / Report
* OQ Protocol / Report
* PQ Protocol / Report
* Validation deviations
* Final Traceability Matrix
* Validation Summary Report

Supplier documentation and FAT/SAT evidence may support qualification activities without making the supplier responsible for the customer's Validation process.

### Gate: Validation Complete

Required completion outcomes are expressed through the acceptance requirements of the Validation Deliverables, including:

* applicable IQ completed;
* applicable OQ completed;
* applicable PQ completed;
* critical Validation deviations closed;
* remaining deviations formally dispositioned;
* Requirements Traceability complete;
* Validation Summary Report approved.

---

# 11. Project Closure

Purpose:

Complete overall Project handover, archiving and administrative closure.

Typical Deliverables/information:

* Final Project documentation
* Final Master Layout
* Final Scope / as-built Scope
* Final Project Budget / Actual Cost
* Final Schedule performance
* Final handover
* Remaining Action closure
* Final Risk review
* Lessons Learned
* Post-Mortem
* Project performance report
* Internal Project Archive
* Customer Handover Package where applicable

### Gate: Project Closed

Required completion outcomes are expressed through the acceptance requirements of the Closure Deliverables, including:

* required Packages closed;
* Validation complete or not applicable;
* final documentation complete;
* required as-built documentation available;
* financial closure complete;
* open Changes resolved;
* critical Actions/Issues resolved;
* handover complete;
* Lessons Learned completed;
* required Project Archive generated or confirmed complete.

---

# 12. Packages

A Project may contain zero or more Packages.

Examples:

* Filling Machine
* Conveyors
* Case Packer
* Utilities
* Electrical Installation
* Civil Works
* Automation
* Building Services

Typical Package information:

* Package code
* Package name
* Description
* Package owner
* Current Stage
* Status
* Execution Model
* Target delivery date
* Key milestones
* Tender candidates
* Awarded supplier where applicable

Package codes should be unique within a Project.

Packages progress independently.

Creating a Package should eventually be capable of automatically provisioning the corresponding SharePoint Package structure.

Package creation must use a two-step workflow: first save the Package's basic information, then review applicability for all Package-level Deliverables. New items are Applicable by default, and the Applicability Review must remain available from the Package page.

The Package Applicability Review must group the Package-specific records by Stage and Gate and support Applicable and justified Not Applicable decisions for default and custom Deliverables. Package tailoring must not modify the Project methodology, another Package or the master templates. It does not require Sponsor approval for each individual decision.

The Package Definition Complete Gate must include a default **Package Stage-Gate Deliverable Applicability Matrix** Deliverable. It represents the existing Package Applicability Review across the relevant Definition, Tendering, Procurement, Execution and Closure lifecycle, respecting the Package's existing optional-stage configuration and Execution Model. Its Deliverable title provides the primary Gate-page navigation to the existing Package Applicability Review while its completion status remains independently editable through Gate preparation. It must not create an additional Package-creation step, applicability register, data model or snapshot mechanism.

## 12.1 Package Execution Model

A Package may eventually have one of two Execution Models:

* Internal
* External

The Execution Model does not need to be selected when the Package is created.

Until an approved execution decision exists, the field may remain unset / not yet determined.

This is particularly important because Internal versus External execution may itself be the outcome of Definition or Tendering.

### Internal Package

An Internal Package is primarily executed using internal organizational Resources.

Examples may include:

* Mechanical Engineering;
* Electrical Engineering;
* Automation / PLC;
* Robotics;
* Process Engineering;
* internal installation;
* internal commissioning activities.

Internal Packages may require Resource Planning.

### External Package

An External Package is executed primarily by an external supplier/OEM contracted for that Package.

External Packages may have:

* multiple candidate suppliers during Tendering;
* a preferred supplier following Execution Model & Technical Selection;
* a maximum of one awarded supplier after Contract Award.

If multiple external suppliers are directly contracted by the customer for materially different Scopes, separate Packages should normally be created.

Subcontractors used by an awarded supplier do not automatically become separately awarded suppliers.

## 12.2 Timing of Execution Model Decision

The Internal/External decision may occur at different moments.

### Decision during Definition

The Project team may already know during Definition that the Package will be executed Internally or Externally.

In that case, Tendering may be skipped where appropriate.

### Decision during Tendering

Where make-or-buy is not yet decided, the Package may proceed through Tendering while the organization evaluates:

* internal execution;
* external supplier solutions;
* technical capability;
* available internal capacity;
* Schedule;
* Cost;
* Risk;
* other relevant criteria.

The Internal/External decision may then be made at the end of Tendering.

## 12.3 Package Financial Information

A Package should NOT contain an independently entered Budget Allocation.

The Project Budget is the single source of truth for Project and Package financial information.

Project Budget lines may be associated with:

* no Package, for Project-level Costs;
* one Package;
* where justified by the future Cost model, multiple Packages.

Package financial information should be derived from the Project Budget lines associated with that Package.

This may eventually include:

* Original Approved Budget;
* Approved Changes;
* Current Approved Budget;
* Commitments;
* Actual Cost;
* Forecast Cost;
* Remaining Budget;
* Variance.

These values should not require duplicate manual entry at Package level.

The Package Overview and Package Detail may display financial information, but this should be a filtered/aggregated view of the central Project Budget rather than a separate Package Budget.

---

# 13. Package Lifecycle

The Package lifecycle should support different execution routes without requiring separate rigid lifecycle models for Internal and External Packages.

The default Package lifecycle contains:

1. Definition
2. Tendering
3. Procurement
4. Execution
5. Closure

However, Tendering and Procurement may be skipped when they are not applicable.

Stages should support an applicability state such as:

* Applicable
* Not Applicable / Skipped

The application should preserve traceability of skipped Stages and the reason for skipping them.

## 13.1 External Execution Route

A typical externally executed Package may follow:

Definition
→ Tendering
→ Procurement
→ Execution
→ Closure

## 13.2 Internal Execution — Decision During Definition

If Internal execution is approved during Definition:

Definition
→ Execution
→ Closure

Tendering may be skipped.

Procurement may be skipped.

## 13.3 Internal Execution — Decision During Tendering

If the execution strategy remains undecided after Definition:

Definition
→ Tendering

If Internal execution is selected:

Definition
→ Tendering
→ Execution
→ Closure

Procurement is skipped because no external supplier Contract Award is required.

## 13.4 External Decision During Tendering

If External execution is selected:

Definition
→ Tendering
→ Procurement
→ Execution
→ Closure

The preferred external solution/supplier proceeds into commercial Procurement and Contract Award.

## 13.5 Lifecycle Principle

The lifecycle should represent the actual governance path taken by the Package.

Skipping a Stage must be an explicit and traceable Decision.

The application should not force users through Tendering or Procurement merely to satisfy a rigid workflow when those Stages are genuinely not applicable.

Skipping a Stage must not automatically eliminate Deliverables or governance obligations that remain necessary.

---

# 14. Package Stages and Gates

The Package methodology contains exactly 42 default Deliverables across the existing five-stage Package lifecycle. Tendering and Procurement remain subject to the existing lifecycle applicability and Execution Model configuration.

### Definition Complete — 9 Deliverables

1. Package Scope & Interface Definition
2. Package Requirements
3. Maintenance & Reliability Requirements
4. Production Integration Requirements
5. Package RACI / Package Organization
6. Package Milestone Requirements
7. Preliminary Internal Resource Estimate — where applicable
8. Package Stage-Gate Deliverable Applicability Matrix
9. Package Risk Assessment

Package Requirements contain the applicable functional, technical, performance, safety, interface, documentation, FAT/SAT and acceptance requirements, including the relevant Project Site Organization & EHS Plan requirements. They support both supplier-facing RFQ preparation and internally executed detailed engineering. The Applicability Matrix remains mandatory and locked.

### Execution Model & Technical Selection — 7 Deliverables

1. RFQ / Tender Package
2. Supplier Proposal(s) — where applicable
3. Technical Evaluation / TECO — where applicable
4. Maintenance & Reliability Evaluation
5. Internal Execution Proposal — where applicable
6. Internal Resource Estimate — where applicable
7. Execution Model & Technical Selection Recommendation and Decision Record

The final Decision Record covers technical evaluation, Internal-versus-External feasibility, Cost and Schedule implications, Risks, major Interfaces, the recommended Execution Model and the formal Decision without duplicating configured Gate approvals.

### Contract Award — 4 Deliverables

1. Commercial Evaluation & Award Recommendation
2. Contract / CND
3. CCA / LOI — where applicable
4. Purchase Order

Contract / CND covers contractual Scope, Interfaces, responsibilities, Schedule and applicable commercial terms. Commercial Evaluation & Award Recommendation covers comparison, negotiated position, Budget alignment, contractual Risks and supplier recommendation. Existing applicability logic remains available where a contractual instrument is not required.

### Package Handover / Execution Complete — 17 Deliverables

1. Approved Design Documentation
2. FAT Protocol / Report — where applicable
3. Installation Documentation — where applicable
4. Commissioning Documentation — where applicable
5. SAT Protocol / Report — where applicable
6. Maintenance Strategy & Reliability Assessment
7. CMMS / EAM Master Data Input Handover
8. Maintenance Support, Spare Parts & Spares Information
9. Package Training & Qualification Evidence
10. Production Master Data Input Handover
11. Production Interface & Integration Verification
12. Production Operational Readiness & Training
13. Manuals
14. SNAG / Punch List
15. Equipment Safety & Commissioning Release Checklist (Indienststelling)
16. Handover & Provisional Acceptance Record
17. As-Built Documentation

Package Execution follows the approved Project site organization and EHS arrangements while preparing and handing over complete equipment-specific maintenance and production master-data inputs. Project Delivery owns consolidated receiving-system integration verification. Existing FAT/SAT and other test evidence should be reused rather than duplicated. The Equipment Safety & Commissioning Release Checklist remains separate equipment-specific safety acceptance evidence covering applicable EHS review, safety documentation, CE conformity, Risk assessment, safeguarding, emergency stops, LOTO and authorization for intended use. It must be completed before intended use, including when release precedes the administrative Package Handover Gate, while preserving applicable controlled commissioning and test-operation arrangements.

### Package Closed — 5 Deliverables

1. Final As-Built Package
2. Final Package Cost Summary
3. Final Acceptance Documentation — where applicable
4. Warranty Documentation — where applicable
5. Package Post-Mortem

The Package Post-Mortem includes supplier or internal execution performance, Lessons Learned and improvement opportunities.

## 14.1 Definition

Purpose:

Define what the Package must deliver and establish sufficient information to determine the appropriate execution route.

Typical Deliverables/information:

* Package Scope
* Package Requirements
* Budget requirements / Project Budget relationship
* Required delivery dates
* Package milestones
* Interfaces
* Package Risks
* FAT/SAT requirements where applicable
* documentation requirements
* Validation support requirements where applicable
* preliminary execution strategy
* preliminary internal Resource requirements where relevant
* **Maintenance & Reliability Requirements** — Defines maintainability requirements, applicable ACA/FLOCCA/FMECA/RCM2 analysis depth, CMMS/EAM master data, spare parts, training and support requirements.
* **Production Integration Requirements** — Defines the Package-specific production integration requirements, including production order handling; production BOM/recipe requirements; material identification and consumption; batch/lot traceability; equipment-to-MES/ERP interfaces; production confirmations; relevant automation and IT/OT interfaces; and production master-data responsibilities where applicable.

### Package Requirements

Package Requirements consolidate the functional, technical, performance, safety, Interface, documentation, FAT/SAT and acceptance requirements formerly split across Package Requirements and a separate Technical Specification Deliverable. They incorporate the applicable common requirements from the approved Project Site Organization & EHS Plan without creating a duplicate Package EHS Deliverable.

If Tendering is performed, the RFQ / Tender Package translates these approved requirements, including applicable Project site and EHS obligations, into supplier-facing documentation. If Tendering is skipped because Internal execution is selected during Definition, Package Requirements provide the technical basis for detailed engineering and execution remains subject to the approved Project site organization and EHS arrangements.

General principle:

> Skipping a Stage must not automatically remove a Deliverable that remains necessary for proper Project execution.

### Gate: Definition Complete

The Gate should determine whether the Package is sufficiently defined to proceed.

The default Definition Complete Deliverables include the **Package Stage-Gate Deliverable Applicability Matrix**. It remains available as navigation to the live Package Applicability Review after submission or approval, subject to the existing editing restrictions. The Package applicability configuration submitted with this Gate must continue to use the existing frozen Review Cycle applicability snapshot so later live changes cannot rewrite historical evidence.

The acceptance requirements of the Definition Deliverables cover maintenance and reliability requirements, production integration, Interfaces, applicable master data and required analysis depth.

Possible outcomes may include:

* proceed to Tendering;
* approve Internal execution and proceed toward Execution;
* approve another applicable route;
* rework/action required.

---

## 14.2 Tendering

Tendering may serve two related purposes:

1. selecting the preferred external technical solution/supplier; and/or
2. supporting an Internal-versus-External make-or-buy Decision.

Typical Deliverables/information may include:

* RFQ / Tender Package
* Technical Specification
* Supplier proposals
* Clarification records
* Technical bid comparison
* deviations list
* Supplier Risk assessment
* internal execution proposal where applicable
* internal Resource estimate where applicable
* internal Cost estimate where applicable
* Schedule comparison
* technical recommendation
* make-or-buy evaluation where applicable
* **Maintenance & Reliability Evaluation** — Evaluates external supplier or internal execution proposals regarding maintainability, lifecycle cost, spare parts, maintenance support and training.

Multiple external supplier candidates may be associated with the Package during this Stage.

Where Internal execution remains an option, the Internal execution proposal should be capable of being considered alongside external alternatives.

### Gate: Execution Model & Technical Selection

This Gate determines how the Package will be executed.

The Technical Evaluation, Maintenance & Reliability Evaluation and final Decision Record acceptance requirements cover technical compliance, Cost, Schedule, Risk, Interfaces and the Execution Model without a separate checklist.

Production integration compliance should be evaluated within the existing Technical Evaluation / TECO. Tendering does not introduce an additional Production integration Deliverable.

The approved Execution Model must be:

* Internal; or
* External.

If Internal is selected:

* Execution Model becomes Internal;
* Procurement may be skipped;
* the Package proceeds toward Execution;
* the Internal Resource Plan becomes relevant for Portfolio Resource Planning.

If External is selected:

* Execution Model becomes External;
* a preferred external supplier/solution may be identified;
* the Package proceeds to Procurement;
* formal supplier award occurs later at Contract Award.

---

## 14.3 Procurement

Procurement is primarily applicable to External Packages requiring commercial contracting with an external supplier.

Typical activities/Deliverables:

* Commercial comparison
* Commercial negotiation
* Commercial recommendation
* Approval / Steering Committee Decision
* Contract / CND
* CCA / LOI where applicable
* Purchase Request
* Purchase Order
* Contractual Scope
* Contractual Schedule
* Final commercial value

Relevant maintenance obligations identified through the approved requirements and evaluation should be incorporated into the existing contractual Deliverables. Procurement does not introduce an additional Maintenance & Reliability Deliverable.

Relevant production integration obligations should be incorporated into the existing Contractual Scope and Technical Specification. Procurement does not introduce an additional Production integration Deliverable.

### Gate: Contract Award

Purpose:

Confirm external supplier appointment and contractual commitment.

After Contract Award:

* Execution Model = External;
* the Package has a maximum of one awarded supplier.

For an Internal Package where no external Contract Award is required, Procurement may be marked Not Applicable / Skipped.

---

## 14.4 Execution

Execution applies to both Internal and External Packages.

### External Package

Typical activities may include:

* Supplier Kick-off
* Detailed Engineering
* Design Reviews
* Manufacturing / Development
* FAT Readiness
* FAT
* Delivery
* Installation Readiness
* Installation
* Commissioning
* SAT
* Ramp-up
* Equipment Handover
* Provisional Acceptance where applicable

Typical Deliverables may include:

* detailed design documentation;
* drawings;
* software documentation;
* FAT Protocol;
* FAT Report;
* installation documentation;
* commissioning documentation;
* SAT Protocol;
* SAT Report;
* manuals;
* spare-parts documentation;
* training documentation;
* SNAG / punch list;
* Provisional Acceptance documentation where applicable.

### Internal Package

Typical activities may include:

* Internal Kick-off
* Detailed Engineering
* Mechanical Design
* Electrical Design
* Automation / PLC development
* Robotics development
* Design Reviews
* Procurement of required components where applicable
* Assembly / implementation
* Internal testing
* Installation
* Commissioning
* SAT / Verification where applicable
* Handover

### Maintenance & Reliability Deliverables

The following default Package-level Deliverables apply at Package Handover / Execution Complete, subject to Package applicability:

* **Maintenance Strategy & Reliability Assessment** — Approved reactive, preventive, predictive/condition-based and failure-finding maintenance strategy as applicable, supported by ACA, FLOCCA, FMECA/RCM2 or other required analyses.
* **CMMS / EAM Master Data Handover** — Asset hierarchy, functional locations, equipment records, BOMs, task lists, maintenance plans and counters where applicable, including verification of correct CMMS/EAM implementation.
* **Maintenance Support & Spare Parts Plan** — Critical spare-parts assessment and availability, OEM/SLA support arrangements and L1 operator / L2 internal maintenance / L3 OEM intervention and escalation matrix.
* **Training & Qualification Matrix** — Operator and maintenance competency requirements, training completion and qualification evidence, including intervention authorization where applicable.

### Production Integration Deliverables

The following default Package-level Deliverables apply at Package Handover / Execution Complete, subject to Package applicability:

* **Production Master Data Handover** — Covers applicable production BOMs, work centers, routings, recipes, material definitions, production versions, equipment/system references and other required ERP/MES master data, including SAP PP master data where applicable. Confirms that required data has been prepared, transferred and verified in the responsible system.
* **Production Interface & Integration Verification** — Demonstrates that applicable production interfaces and data exchanges have been tested, including where relevant production order transfer; recipe/parameter transfer; material identification and consumption; production confirmations; batch/lot traceability; machine/MES/ERP communication; and interface failure/recovery scenarios.
* **Production Operational Readiness & Training** — Demonstrates that the receiving Production organization is prepared to operate the Package, covering applicable operating procedures; operator training and required qualifications; production master-data readiness; operational responsibilities; outstanding production issues; and formal operational acceptance.

Production Master Data Handover confirms that required data has been prepared, transferred and verified in the responsible system. Production Interface & Integration Verification separately confirms that the implemented system interfaces and data exchanges operate as required. Existing FAT/SAT and Verification documentation should provide supporting evidence where appropriate; duplicate test protocols should not be created.

The exact Execution activities and Deliverables depend on Package type and should not be rigidly hard-coded based only on Internal/External classification.

### Gate: Package Handover / Execution Complete

This Gate confirms that the Package has been executed sufficiently for handover or subsequent Project activities.

For external equipment Packages this may correspond to Equipment Handover.

For Internal Packages, supporting evidence and terminology may differ depending on Package type. The applicable Package Execution Deliverables must demonstrate maintenance readiness, complete equipment-specific CMMS/EAM and Production master-data input handover, tested production Interfaces, required personnel qualifications and readiness of the receiving Production organization.

---

## 14.5 Closure

Closure applies to both Internal and External Packages.

Typical activities/Deliverables:

* open Action/SNAG closure;
* final documentation;
* as-built documentation;
* final Cost information;
* Lessons Learned where relevant.

External Packages may additionally include:

* final commercial settlement;
* Final Acceptance;
* warranty information;
* supplier performance evaluation.

No additional Maintenance & Reliability Deliverable is required at Package Closure. Final maintenance acceptance and outstanding maintenance items should be documented through the existing Package Closure Deliverables.

No additional Production integration Deliverable is required at Package Closure. Final Production acceptance and remaining production integration Actions should be documented through the existing Package Closure Deliverables.

### Gate: Package Closed

Package Closed does NOT imply Project Closed.

---

# 15. Gates, Deliverables and Stage Skipping

Stages may end with formal Gates.

A Gate should eventually support:

* Gate name
* Planned date
* Actual review date
* Gate owner
* Required Deliverables
* Open Actions
* Decision
* Comments
* Approval traceability

Possible Gate Decisions:

* Not reviewed
* Approved
* Approved with Actions
* Rejected / Rework required

## 15.1 Deliverable

A Deliverable is something that must be produced or achieved.

Examples:

* Package Scope;
* approved URS;
* Technical Specification;
* FAT Protocol;
* FAT successfully completed;
* SAT Report;
* operator training completed.

Documents may provide evidence that a Deliverable has been completed.

Conceptually:

Stage
→ Gate
→ Deliverables with acceptance requirements

Default Deliverables retain explicit acceptance requirements as legacy methodology metadata. These requirements may require evidence from controlled Documents, living registers, Project Controls or formal workflow records, but they are not maintained as a separate checklist. Acceptance requirements are not displayed or edited in the active Project Gate, Package Gate or Applicability Review interface. Existing stored descriptions must be preserved when another Deliverable field is edited.

The application should not consider a Gate ready merely because required files exist.

Maintenance & Reliability Deliverables are governance records, not maintenance-analysis editors or a separate CMMS/EAM module. A consolidated Deliverable may reference multiple controlled Documents. Supporting analyses and evidence should eventually be linked through the planned SharePoint/document-reference architecture.

Production integration Deliverables are system-agnostic governance records. In an SAP PP-centric environment, SAP PP may manage production master data and production orders while local machines and operators perform production execution and consumption is recorded through confirmations or backflushing. In an MES-centric environment, ERP may manage planning, inventory and financial functions while MES manages detailed execution, recipes, electronic batch records and material genealogy and returns production confirmations and material consumption to ERP. SAP PP and PAS-X are examples rather than mandatory systems.

The application should track production integration requirements, responsibilities, Deliverables and Verification evidence regardless of the underlying system architecture. These Deliverables may reference approved URS, Technical Specifications, Automation Design, FAT/SAT, training, handover, Validation and as-built documentation. A separate Document should not be created where approved existing evidence already provides the required information. This methodology does not introduce a separate Production module or production-system integration functionality.

## 15.1.1 Applicability and Completion

Applicability answers whether a Deliverable is required for a specific Project or Package. Completion answers whether its acceptance requirements have been satisfied. These are separate properties of the same Project/Package-specific Gate record.

Applicability values are:

* Applicable;
* Not Applicable.

Applicable is the default for every newly instantiated default item and every new custom item. The active workflow must not use an unresolved applicability state.

Completion values remain:

* Deliverable: Not Started, In Progress or Completed.

An item that is Not Applicable must be displayed consistently as Not Applicable on both the Applicability Review and Gate page. Applicability changes must not modify the item's completion status. The status is preserved while the item is Not Applicable, excluded from Gate completion requirements, and becomes effective again if the item returns to Applicable. Returning an item to Applicable must not automatically mark an item Completed if it was not already Completed. A previously Completed item may be reopened through the normal Gate preparation workflow.

New Not Applicable decisions require a short justification and must record the authenticated user and date/time. Historical Not Applicable records without a justification must be preserved without inventing a reason. Subsequent applicability changes must record who changed the decision and when it changed without modifying frozen Review Cycle evidence. The active workflow does not require a separate Reason for change field; previously recorded reasons remain immutable historical evidence.

Template-created default items must remain traceable and must not be deleted merely because they are Not Applicable. PM-created custom items may be added and edited without an acceptance-requirement description, and may be removed only while they are not part of formal submitted or approved governance evidence.

## 15.2 Living Applicability Matrix Review

The single Project or Package Stage-Gate Deliverable Applicability Matrix is a living governance record. It is initially tailored across the complete active lifecycle during Project Initiation or Package Definition and remains available throughout the lifecycle. The existing Project and Package Applicability Matrix Deliverables remain locked and Applicable. Their completion records the initial tailoring activity and is independent of later Gate confirmations; it must not be reset when another Gate is prepared.

Submitting or formally approving a Gate protects two related Deliverable baselines. First, the Gate's own Stage is the submitted or approved completed-Stage baseline: its stable Deliverable set, default/custom classification, titles, stored acceptance metadata, applicability decisions, Not Applicable justifications, completion statuses and completion evidence are frozen. Second, the Gate protects the Deliverable-configuration baseline for the next active Stage resolved by the lifecycle rules: its stable Deliverable set, default/custom classification, titles, stored acceptance metadata, applicability decisions and Not Applicable justifications are frozen. While either protection applies, Project Owners, Package Leads, ordinary users and direct mutation calls must not bypass it.

Normal execution progress remains permitted for an active Stage whose configuration is protected only by the preceding submitted or approved Gate. Its Deliverable completion statuses may continue to move between Not Started, In Progress and Completed without changing or invalidating that next-Stage configuration baseline. Once the active Stage's own Gate is submitted or approved, those completion statuses and the associated completion evidence are also frozen.

Future Stages that have not yet been baselined remain editable. Reopening the governing Gate is the only way to revise its own approved completed-Stage baseline and the next-Stage baseline governed by that Gate. During preparation, the exact Gate carrying `reapproval_required` may revise its own Stage configuration and completion records even when the preceding Gate remains approved; this controlled exception does not unlock that preceding Gate or any unrelated earlier Stage. Reopening also unlocks the next-Stage Deliverable configuration governed by the reopened Gate. Resubmission ends the exception and freezes both configurations again. Existing Deliverable IDs and completion statuses must not be reset during reopening or reapproval.

Before every future eligible Project or Package Gate submission, an authenticated Project editor or owner must explicitly confirm the matrix configuration relevant to that Gate. Merely opening or viewing the matrix does not confirm it. For a non-Closure Gate, the review focuses on the next applicable Stage selected by the existing lifecycle rules. A Project with Validation disabled must skip Validation. Package review follows the configured Package lifecycle without introducing new Stage-skipping behavior. At Closure, the confirmation covers the final active lifecycle matrix rather than a nonexistent next Stage.

For every Project or Package Gate with a next applicable Stage, the Gate page actions must be labelled **Review Next Stage Deliverables** and **Confirm Next Stage Deliverables**. The review action opens the existing Applicability Matrix focused on the Stage resolved by the lifecycle logic, and the page identifies it as **Reviewing Stage: [resolved Stage name]**. Closure Gates use **Review Final Applicability Matrix** and **Confirm Final Applicability Matrix** and identify **Reviewing Scope: Complete active lifecycle matrix**. Stage names must not be hardcoded into the action labels, and no separate matrix may be created.

The Gate Submission area must show the reviewed Stage or final lifecycle, Applicable and Not Applicable Deliverable counts, a link to the existing matrix focused on the reviewed Stage where applicable, and the current confirmation status. The active matrix interface shows Deliverable title, Default or Custom classification, Stage/Gate grouping, applicability and any Not Applicable justification; it does not display or edit acceptance requirements. A valid confirmation records the Gate, reviewed Stage or final lifecycle, authenticated reviewer, timestamp and a deterministic fingerprint of the reviewed configuration.

The fingerprint must cover the stable Deliverable set, titles, applicability decisions, Not Applicable justifications and acceptance requirements. It must not include completion status or mutable audit timestamps. A relevant change or a change in Deliverable composition invalidates the confirmation. Completion-status changes and changes confined to unrelated future Stages do not invalidate a next-Stage confirmation. Withdrawing a Review Cycle preserves the confirmation, which remains valid when the current fingerprint still matches; withdrawal alone must not require reconfirmation.

Submission must transactionally verify the confirmation against the live PostgreSQL configuration. Each new Review Cycle must freeze the confirmation, reviewer attribution, fingerprint and complete current matrix, including the exact reviewed Stage applicability and stored acceptance metadata. Formal Gate Approvers review this immutable evidence through the existing sequential approval workflow. Previously submitted or approved Review Cycles remain unchanged, and already approved Gates must not be retroactively blocked. Dedicated historical approval views may continue to display the acceptance requirements contained in frozen evidence.

## 15.3 Stage Skipping

A Stage may be marked Not Applicable / Skipped when the approved Package execution route does not require that Stage.

Skipping a Stage should record:

* skipped Stage;
* date;
* Decision/approval;
* reason;
* user responsible;
* related Gate or Decision where applicable.

Skipping a Stage must not automatically remove its relevant Deliverables.

Where a Deliverable remains necessary, it should be:

* completed in an earlier Stage;
* reassigned to another applicable Stage; or
* explicitly marked Not Applicable with justification.

Not every Package requires the same depth of reliability analysis. The existing Not Applicable status should be used with justification where a Maintenance & Reliability Deliverable does not apply. ACA, FLOCCA, FMECA, RCM2 and MRO spare-parts assessments are supporting technical analyses rather than separate mandatory Gate Deliverables. Detailed FMECA or RCM2 analysis should not be mandatory for low-criticality equipment unless required by the approved Project methodology.

Not every Package requires direct ERP/MES integration. The existing Not Applicable status should be used where a Production integration Deliverable does not apply. A production machine with MES connectivity may require all three Package-level Production integration Deliverables. A simple mechanical utility Package may have no direct production master-data requirements. A conveyor Package may require Production Interface & Integration Verification but no dedicated production BOM. The PM should determine applicability per Deliverable rather than treating all Production integration Deliverables as mandatory for every Package.

Example:

If an Internal Package skips Tendering, its Package Requirements remain required and provide the basis for detailed engineering.

## 15.4 Gate Review

A Gate is a formal governance decision authorizing progression from one Project or Package Stage to the next applicable Stage.

A Gate approval must therefore create a permanent and auditable record of:

- what was reviewed;
- which Deliverables were submitted;
- which exact Document revisions/versions supported the review;
- which open Actions were accepted;
- what Decision was made;
- who was required to approve;
- who actually approved;
- when each approval occurred.

A Gate approval must not be represented only by changing a Gate status field.

Each formal Gate Review should create a persistent Gate Review Record.

The Gate Review Record should eventually contain at minimum:

- Gate Review ID;
- Project;
- Package where applicable;
- Gate;
- related Stage;
- review status;
- review date;
- Gate Decision;
- Decision comments;
- Deliverables, their acceptance requirements and their status at the time of review;
- accepted open Actions;
- required Approvers;
- approval/signature status per Approver;
- approval/signature timestamps;
- references to the exact controlled Document revisions/versions reviewed;
- applicable Scope, Cost and Schedule baseline references;
- generated Gate Review Report reference.

The Gate Review Record represents the historical state of the Gate at the time the Decision was made.

Subsequent changes to Project information, Deliverables or Documents must not silently alter the historical Gate Review Record.

---

## 15.5 Gate Decision Behaviour

The supported Gate Decisions are:

- Not reviewed;
- Approved;
- Approved with Actions;
- Rejected / Rework required.

### Approved

`Approved` means:

- all mandatory Deliverables are Completed or Not Applicable;
- all required Approvers have provided the required approval/signature;
- progression to the next applicable Stage is authorized.

### Approved with Actions

`Approved with Actions` means:

- progression is formally authorized;
- explicitly identified non-blocking Actions remain open;
- those Actions are recorded in the Project Master Action Register;
- each accepted Action has an owner and due date;
- required Approvers explicitly accept progression with those open Actions.

`Approved with Actions` must not be used as a generic method for bypassing incomplete Deliverables.

The live Gate must remain `Approved with Actions` while one or more Actions explicitly linked to the controlling approved Review Cycle are not `Closed`. `Finished` is not equivalent to `Closed`. When the final controlling follow-up Action is Closed, the application must transactionally reconcile the live Gate to `Approved` without requiring another signature or changing the current Project or Package Stage. If a controlling Action is subsequently reopened, the live Gate must return to `Approved with Actions`; closing it again must restore `Approved`.

Automatic reconciliation must use only explicit, reliable Action-to-Review-Cycle relationships. Unrelated Project or Package Actions, Actions linked only to another Review Cycle and ambiguous historical references without a Review Cycle ID must not affect the live Gate. Reconciliation must append an attributable, timestamped audit event while preserving the original Review Cycle decision, approval responses, signatures and completion evidence.

At final approval, each linked follow-up Action must retain immutable approval-time evidence including its stable Action ID, sequence, description, owner, due date, status, Gate reference and Review Cycle reference. This approval-time evidence must remain separate from the live Action record. Existing frozen Review Cycle evidence and historical references must not be rewritten, inferred or backfilled.

Internal Review History must present these records under **Gate Actions — Follow-up**, showing frozen Action evidence separately from current live status, the current closure date where available and a direct link to the corresponding Project Master Action Register entry. If the live Action is unavailable, its frozen historical evidence must remain visible with an unavailable-reference indication. External OTP Review access must remain limited to its authorized frozen Review Cycle evidence and must not expose live Action Register links or unrelated Project or Package information.

An Action referenced by a formal Gate decision must not be deleted. Reopening remains available through the authorized Action workflow and must preserve Action history and trigger the corresponding live Gate reconciliation. A separate waiver, cancellation or MOC disposition workflow is outside this increment.

The same reconciliation, evidence, audit and deletion rules apply to Project Gates and Package Gates.

### Rejected / Rework Required

`Rejected / Rework required` means:

- the Gate has been formally reviewed;
- progression has not been authorized;
- the Project or Package remains in the current Stage;
- Deliverables and other relevant information may be updated;
- the Gate may subsequently be submitted for review again.

### Not Reviewed

`Not reviewed` means no current formal Gate approval Decision is active.

A previously reviewed Gate may eventually be deliberately reopened/reset to `Not reviewed`.

Reopening a Gate must not delete historical approval information, previously generated Gate Review Records or Actions created during earlier reviews.

---

## 15.6 Gate Approvers

Each Gate should support one or more required Approvers.

Approvers should be configurable for the specific Project or Package rather than permanently hard-coded.

Gate Templates may define default required approval roles.

Examples may include:

- Project Manager;
- Project Sponsor;
- Business Owner;
- Resource / Engineering Manager;
- Package Owner;
- Production representative;
- Maintenance representative;
- Quality representative;
- Validation representative;
- Procurement representative;
- Budget owner;
- other configurable Project stakeholders.

Different Gates may require different approval roles.

For example:

### Project Baseline Approval

May require:

- Project Manager;
- Project Sponsor;
- Resource / Engineering Manager;
- Business Owner;
- Quality where applicable.

### Contract Award

May require:

- Package Owner;
- Project Manager;
- Engineering approver;
- Procurement;
- Budget owner.

### Validation Complete

May require:

- Validation;
- Quality;
- System / Process Owner.

The exact approval structure should be configurable per Project and, where applicable, per Gate.

---

## 15.7 Approver Configuration and Identity

The Project Manager or another authorized user should be able to configure the Approvers required for each Gate.

An Approver configuration contains:

- name;
- organization;
- role/function;
- email address;
- required approval role;
- approval sequence where applicable.

The same person may fulfil different approval roles on different Projects or Gates. Each live Gate Approver assignment is configured directly using name, email address, optional organization, Role / Function, Gate Approval Role and Approval Level. Configuration and submission must not require an application User, Microsoft Entra tenant ID, Object ID, B2B onboarding, prior sign-in or identity-linking status.

All new Gate Review Cycles use email one-time-code verification for internal and external Approvers. Microsoft Entra and Better Auth remain the authentication mechanism for the operational application and its Project users, but they are not prerequisites for Gate approval access.

On submission, each frozen Approver assignment receives an opaque assignment-specific Review Gate access identifier. Possession of the link identifies the assignment but does not authorize access to frozen evidence or a response. The Approver must request and successfully verify a one-time code delivered to the exact frozen email address before the application establishes a restricted Review Cycle session.

The one-time code must:

- be generated using a cryptographically secure random source;
- be stored only as a keyed digest and never logged or persisted in plaintext;
- expire after 10 minutes;
- be single-use;
- permit no more than five failed verification attempts;
- enforce a minimum 60-second resend interval and no more than five code requests per assignment in one hour;
- return non-enumerating user-facing errors.

A successful verification establishes an HTTP-only, same-site, restricted Review Cycle session lasting no more than 30 minutes. The session authorizes only its exact frozen Review Cycle Approver assignment and cannot grant operational application access. Approval and Return for Rework remain server-authorized against the active Review Cycle, session, frozen assignment and sequential Approval Level at the moment of response.

Withdrawn, returned, completed or superseded Review Cycles must not issue or verify new codes. A session cannot submit a response after withdrawal or another terminal transition. Resubmission creates new frozen assignments, access identifiers and OTP authority; no code, session or approval carries forward.

OTP requests, sanitized delivery outcomes, failed and successful verification events, session creation and OTP-authorized responses must be audit logged without recording the code, code digest or session token.

Historical Entra-authorized Review Cycles, Approver snapshots, responses, timestamps, comments and identity evidence must remain unchanged. Migration to email OTP is forward-only and must not backfill, relabel or rewrite those records.

The PM may configure an Approver's identity and contact information but must never enter or manage another user's password, OTP or authentication credentials.

---

## 15.8 Gate Signature Invitation Workflow

The application should support sending formal Gate approval/signature invitations to required Approvers.

When a Gate is submitted for approval:

1. the PM completes the Gate Review;
2. the Gate Review content and supporting evidence are frozen for that review cycle;
3. the required Approvers are identified;
4. each required Approver receives an assignment-specific approval/signature invitation when their configured Approval Level becomes eligible;
5. the Approver requests and verifies a one-time code sent to the frozen email address;
6. the application establishes a restricted, short-lived Review Cycle session;
7. the Approver securely accesses the frozen Gate Review evidence;
8. the Approver reviews the Gate Decision, Deliverables, acceptance requirements, accepted Actions and supporting evidence;
9. the Approver approves/signs or returns the Gate for rework with comments;
10. the application records the result, timestamp and OTP session attribution;
11. the Gate is considered fully approved only when the required approval conditions have been met.

The application should provide visibility of approval progress.

Example:

Project Baseline Approval

- Project Manager — Approved
- Engineering Manager — Approved
- Business Owner — Pending
- Quality — Approved

The PM should be able to identify which required approvals remain outstanding.

Email-based invitations should identify the frozen Review Cycle without treating access to the link or an email reply as formal approval. Delivery attempts and sanitized delivery results should remain visible as historical records. Provider acceptance means that the invitation was accepted for delivery; it does not prove inbox delivery.

Known failed deliveries may be retried manually while the Approver remains eligible. Unconfirmed delivery outcomes should not be retried automatically because the original send may have succeeded. Stable delivery identifiers and concurrency controls should prevent unnecessary duplicate sends.

Invitation delivery failure must not record, alter or imply an approval Decision. It should be reported clearly without undoing the submitted Review Cycle.

The formal approval/signature should occur through the restricted email OTP workflow for all new Review Cycles.

---

## 15.9 Authentication and Signature Traceability

A Gate approval/signature must be attributable to an identifiable person.

Operational application users authenticate through Microsoft Entra / Better Auth. Gate Approvers authenticate their frozen assignment through email OTP, regardless of whether they are also operational application users.

The application should eventually record sufficient information to demonstrate:

- who approved;
- what they approved;
- in which approval role;
- when they approved;
- the meaning of the approval;
- which Gate Review version was approved.

A normal authenticated application approval and a regulated electronic signature are not automatically equivalent.

Where a Project requires regulated electronic signatures or specific compliance requirements, the architecture should support integration with an appropriate compliant electronic-signature solution or enhanced signature workflow.

The application must not claim regulatory electronic-signature compliance merely because an authenticated user clicked an approval button.

---

## 15.10 Frozen Gate Review Evidence

When a Gate Review is formally submitted for approval, the evidence being reviewed should be frozen for that review cycle.

New Review Cycles freeze the Deliverables-only methodology. Historical Review Cycles created under the former Gate Criteria methodology retain their immutable Criteria snapshots and must continue to render them as legacy historical evidence. Legacy Criteria must not re-enter active applicability, completion or submission-readiness workflows.

This includes, where applicable:

- Deliverables, their acceptance requirements and their status;
- accepted open Actions;
- controlled Document revisions;
- relevant baseline references;
- other supporting evidence.

Every new Review Cycle must contain the complete current Project or Package Stage-Gate Deliverable Applicability Matrix and its explicit Gate review confirmation. These snapshots must identify default and custom items, descriptions, applicability decisions and Not Applicable justifications, together with the reviewed Stage or final lifecycle, authenticated reviewer, confirmation timestamp and deterministic fingerprint. Later live changes must not modify the snapshot. Historical Review Cycles without a matrix confirmation remain valid and readable and must not be rewritten.

The normal frozen Review Cycle presentation uses one shared Project, Package and Approver view of this immutable evidence. For a Stage-transition Gate it presents two columns:

- **Current Stage — Completed Deliverables** contains only frozen current-stage Deliverables with explicit `Applicable` applicability and explicit `Completed` status;
- **Next Stage — Agreed Deliverables** contains only frozen matrix items with explicit Deliverable type and explicit `Applicable` applicability for the confirmed next Stage; and
- the presentation identifies the reviewed Stage, authenticated reviewer and confirmation timestamp.

Not Applicable items, acceptance requirements, next-Stage completion statuses and technical fingerprints are not displayed in these normal frozen-evidence lists. The underlying snapshots, including applicability decisions, justifications, descriptions and fingerprints, remain unchanged as technical governance evidence.

A Closure Gate instead presents **Final Applicability Matrix — Confirmed** with only the final lifecycle review confirmation attribution. It does not repeat the full lifecycle matrix.

Historical compatibility must be strict. The presentation must not infer missing applicability, completion or confirmation values. If older frozen evidence cannot be classified reliably for one of the normal presentation sections, it shows a concise legacy-evidence notice rather than describing a filtered or empty list as complete. Historical Criteria, accepted Actions, approval and withdrawal history, and authenticated or email-OTP response functionality remain available.

The application should retain immutable references to the exact revisions/versions used for the Gate Decision.

Example:

Project Baseline Approval:

- Project Scope — Rev 04
- URS — Rev 03
- Master Layout — Rev 07
- Project RACI — Rev 02
- Budget Baseline — BL-COST-001
- Schedule Baseline — BL-SCH-001

If any of these Documents or Controls subsequently change, the historical Gate Review must continue to identify the version that was originally reviewed and approved.

---

## 15.11 SharePoint Document Version Traceability

SharePoint is the Document system of record.

Where a Deliverable is supported by a SharePoint Document, the Gate Review should eventually retain a stable reference to the exact SharePoint Document and version/revision reviewed.

The application should not rely solely on a link to the latest Document version.

The Gate Review evidence should support later reconstruction of:

- which Document was reviewed;
- which engineering revision applied;
- which SharePoint version applied;
- its approval/status at the time of the Gate Review.

SharePoint file version and engineering Document revision remain separate concepts and should both be retained where relevant.

The exact technical method for freezing, retaining or protecting approved SharePoint versions should be determined during SharePoint integration design.

---

## 15.12 Relationship to Baselines and Management of Change

Formal Gate approval may establish controlled baselines.

In particular, Project Baseline Approval should eventually establish:

- Scope Baseline;
- Cost / Budget Baseline;
- Schedule Baseline.

The Gate Review Record should retain references to those exact baselines.

Subsequent approved Changes/MOCs may modify the Current Approved State but must not rewrite the historical baseline or historical Gate Review.

Conceptually:

Original Approved Baseline  
+ Approved MOCs  
= Current Approved State

Example:

URS Rev 03  
→ approved at Project Baseline Approval  
→ MOC-007 approved  
→ URS Rev 04 becomes current

The historical Gate Review must continue to show that URS Rev 03 was the revision approved at the original Gate.

MOC-007 provides the traceability from the original approved state to the subsequent approved state.

At later Gates and at Project/Package Closure, applicable Deliverable acceptance requirements may verify that relevant MOCs have been implemented, closed or formally transferred.

---

## 15.13 Formal Gate Review Report

Once a Gate Review has received all required approvals/signatures, the application should eventually generate a formal human-readable Gate Review Report.

The Report should contain at minimum:

- Project identification;
- Package identification where applicable;
- Gate name;
- related Stage;
- Gate Review ID;
- review date;
- Gate Decision;
- Deliverables, acceptance requirements and final statuses;
- accepted open Actions;
- controlled Documents and exact revisions/versions reviewed;
- applicable baseline references;
- Approvers;
- approval roles;
- approval/signature status;
- approval/signature timestamps;
- relevant approval comments.

The generated Gate Review Report should be stored in the appropriate SharePoint Project or Package governance structure.

Conceptually:

Project SharePoint  
→ Governance  
→ Gate Reviews  
→ Project Baseline Approval

Package SharePoint  
→ Package Governance  
→ Gate Reviews  
→ Contract Award

The exact SharePoint folder/library structure should remain configurable.

---

## 15.14 Structured Gate Record vs Generated Report

The structured Gate Review Record in the application is the primary governance/audit record.

The generated Gate Review Report is the human-readable formal representation of that record.

The application should not rely exclusively on the generated PDF or other report file for audit history.

Regenerating a Report later must not silently replace or alter the historical Gate Review content.

The final signed/approved Report should itself be treated as a controlled record.

---

## 15.15 Gate Review Cycles and Reopening

Gate reopening is the only supported backward lifecycle operation. A Project or Package may reopen only the immediately preceding approved Gate that caused progression into its current active Stage. Reopening and the one-Stage backward transition are one transactional operation; no independent Stage rollback operation or direct Stage-decrement API is permitted.

Every reopening requires a non-whitespace reason and an authenticated authorized actor. The audit event must record the actor, timestamp, reason, Gate, previous Stage and target Stage. Project Gate reopening is restricted to a Project Owner. Package Gate reopening is restricted to a Project Owner or the exact active internal Package Lead with Gate Reviews Read & Write for that Package.

Reopening sets the Gate's persistent `reapproval_required` state, returns the Project or Package exactly one active Stage backward and permits controlled revision of both the reopened Gate's own Stage configuration and completion records and the next-Stage Deliverable configuration previously baselined by that Gate. This exception applies only while that exact reopened Gate is in preparation; ordinary Stage navigation cannot enable it. The preceding approved Gate and every unrelated earlier approved Stage remain protected. Active lifecycle resolution must respect optional Validation and all existing Stage-skipping rules. Earlier approved Gates cannot be reopened directly.

Only one Gate in a Project or Package scope may require reapproval at a time. A further backward reopening is prohibited until the reopened Gate has been resubmitted and formally approved. Withdrawal or return for rework does not clear `reapproval_required`. Only successful renewed formal approval clears it and resumes normal forward progression. Gate Action reconciliation must not restore a reopened Gate to Approved or Approved with Actions before that renewed approval.

While a Gate is Submitted for Approval, its own Stage Deliverable configuration and completion evidence and its reviewed next-Stage Deliverable configuration are frozen against live mutation. Withdrawal or return for rework removes the submission lock, but a Stage configuration protected by another approved Gate remains locked unless the exact Stage is operating under the controlled `reapproval_required` preparation exception described above.

While a Project or Package Gate has an active Review Cycle in `Submitted for Approval`, a Project Owner may withdraw that cycle even when one or more Approvers have already responded, provided the Gate has not reached final approval and the related Stage has not progressed. Every withdrawal requires a reason containing non-whitespace text and must be attributed to the authenticated Project Owner.

Withdrawal must be transactional with approval responses so that withdrawal and final approval cannot both succeed. Changing the Review Cycle status to `Withdrawn` cancels all remaining approval authority, prevents later Approval Levels from activating and returns the live Gate to `Not Submitted` for editing. Resubmission must create a new Review Cycle; approvals from the withdrawn cycle must not be carried forward or count toward Stage progression.

A withdrawn Review Cycle remains a complete historical governance record. Its frozen evidence, Approver snapshots, invitation and delivery history, responses, response timestamps, comments and authenticated identity evidence must remain unchanged. The history must clearly identify the cycle as `Withdrawn`, record who withdrew it, when and why, and explain that any approvals shown are historical and no longer effective for Gate approval or Stage progression.

Project Gates and Package Gates must apply the same withdrawal rules. PostgreSQL is the source of truth for the controlled withdrawal operation.

Previous Gate Review Records and signatures must remain preserved.

A new review must not overwrite the historical Decision.

Example:

Gate Review 1  
→ Rejected / Rework required

Rework performed

Gate Review 2  
→ Approved

Both review cycles remain part of the Gate history.

Reopening an already approved Gate must not invalidate, replace or delete its historical approval record. Existing Review Cycles, frozen evidence, Approver snapshots, responses, signatures, OTP evidence, Gate Actions, Action decision references and audit history remain immutable. Resubmission creates a new Review Cycle containing the revised live configuration. Its approval establishes the replacement baseline without rewriting any preceding baseline.

---

## 15.16 Gate Template and Project-Level Configuration

Gate Templates may define default:

- Deliverables and their acceptance requirements;
- required approval roles.

When a Project is created, these defaults should be instantiated for that Project.

The PM should be able to tailor:

- Deliverables and their acceptance requirements;
- required Approvers

to the Project's actual governance structure, subject to appropriate permissions.

When master Gate Templates gain new default Deliverables, the implementation should add only missing default items to existing live Gates. It must not recreate Gates or change their stable IDs; overwrite user-created Deliverables; duplicate existing default items; reset Completed or Not Applicable statuses; alter existing Approvers, approval levels, Gate Actions or Review Cycles; or modify frozen historical Review Cycle snapshots. New defaults must not silently modify active submitted Review Cycles and must preserve existing Stage transitions and Gate approval logic.

For an active submitted or formally approved Gate, new template defaults must not alter the submitted or approved Review Cycle, frozen evidence, approval responses or historical Decision. The new defaults should be assessed only in a future eligible Review Cycle if the Gate is subsequently reopened or otherwise returned to preparation under the existing governance workflow.

Project-specific changes must not modify the master Gate Template.

The Project Applicability Review and individual Gate pages must operate on these same instantiated Deliverable records. They must not maintain parallel applicability registers.

Before Package Definition Complete may be submitted, every new Package-level Not Applicable decision must have a justification. Applicable Deliverables remain subject to the normal completion requirements for that Gate or later Gates; Not Applicable items are excluded without changing their recorded completion status.

This follows the general principle:

Gate Template  
→ Project/Package-specific instance  
→ PM tailoring  
→ Gate Review  
→ Frozen review evidence  
→ Required approvals/signatures  
→ Formal Gate Decision  
→ Gate Review Record and Report

---

# 16. Deliverables

Deliverables are core governance entities.

The Deliverable description stores legacy acceptance-requirement metadata. Existing descriptions and frozen historical evidence must be preserved, but the description is not displayed or editable in the active Deliverable UI. Default methodology Deliverables retain their non-empty stored requirements and submission validation. Custom Deliverables may use an empty description and must not be blocked from creation, editing or Gate submission because acceptance requirements are absent. A Deliverable may be marked Completed only when the responsible user has determined that the required outcome has been achieved.

A Deliverable should eventually support:

* Deliverable ID
* Title
* Description
* Category
* Project
* Scope level
* Related Package(s) where applicable
* Related Stage
* Related Gate
* Owner
* Supplier/internal responsibility
* Planned due date
* Actual completion date
* Status
* Approval status
* Related Document(s)
* Related Requirement(s)
* Comments

Deliverables may represent:

* Documents;
* activities;
* outcomes;
* approvals.

---

# 17. SharePoint Document Architecture

SharePoint should be the primary backend for Project and Package Documents.

The application should use SharePoint for actual file storage rather than creating a separate independent Project file repository.

The application database should store structured metadata and relationships required to understand and govern these Documents.

## 17.1 Project SharePoint Environment

When a Project is created, the application should eventually be capable of automatically creating/provisioning the corresponding standardized SharePoint Project environment.

The exact SharePoint architecture may use:

* Sites;
* Document Libraries;
* folders;
* metadata;
* groups;
* or an appropriate combination.

The final technical design should follow Microsoft/SharePoint best practices rather than assuming every logical Project structure must literally be represented as nested folders.

From the user's perspective, however, the application should present a clear Project/Package Document structure.

## 17.2 Package Structure

When a Package is created, the application should eventually be capable of creating the required Package structure automatically.

A conceptual Package structure may include:

* Definition
* Tendering
* Procurement
* Engineering
* FAT
* Installation
* SAT
* As-Built

The exact structure should be configurable through templates and Package applicability.

Skipped lifecycle Stages should not necessarily require active folders if the configured template does not require them.

## 17.3 Project-Level Documents

Project-level Documents should remain Project-level.

Examples:

* Project Scope
* Master Layout
* Master Schedule export
* Project Charter
* Validation Plan
* overall URS

These Documents should not be duplicated into every Package folder merely because several Packages use them.

Packages may reference the same Project-level Document.

## 17.4 Application Document Metadata

The application should eventually store metadata such as:

* Document ID
* Title
* Category
* Project
* Scope level
* Related Package(s)
* Owner
* Revision
* Status
* Approval status
* Final/as-built status
* Related Deliverable
* Related Requirement(s)
* Related milestone
* Related supplier
* Visibility
* SharePoint Site/Library reference
* SharePoint file/item identifier
* SharePoint location/reference

The application should use stable SharePoint identifiers wherever possible rather than relying solely on human-readable folder paths.

## 17.5 Document Access Through the Application

Where practical, users should be able to work with Documents through the CAPEX application.

Potential functionality includes:

* open Document;
* upload Document;
* create Document;
* update Document;
* replace/revise Document;
* view revision/status;
* relate Document to a Deliverable;
* relate Document to Requirements;
* relate Document to Packages;
* mark final/as-built;
* search/filter Documents.

The physical file remains in SharePoint.

The application should not unnecessarily create a second copy.

## 17.6 SharePoint Versioning

Where SharePoint provides file versioning, the application should leverage it rather than creating unnecessary duplicate file-version systems.

The application may maintain Project-specific revision/status metadata where needed for Project governance.

SharePoint file version and engineering Document revision are related but should not automatically be assumed to be identical concepts.

---

# 18. Application Access and Permission Management

PostgreSQL is the authoritative source for application authorization. Authentication alone, including membership of the configured Microsoft Entra tenant, does not grant access to a Project or Package.

Authorization is determined server-side from three independent dimensions:

* **Scope** — Entire Project including Packages, Overall Project only, or one Specific Package;
* **Module** — for example Overview, Actions, Risks, Issues, Decisions, Changes/MOC, Budget, Planning, Deliverables, Gate Reviews or Documents; and
* **Permission** — No Access, Read, or Read & Write.

No Access is represented by the absence of a positive module permission. An Entire Project scope is an explicit broad assignment; Overall Project access does not imply access to any Package, and a Specific Package assignment does not imply access to the Overall Project or another Package. All route, query and mutation authorization must be enforced on the server against current PostgreSQL state rather than client-side visibility or permission claims stored in an authentication session.

## 18.1 Administrative Authority

The protected Project Owner is the top-level authority and retains complete Project and Package oversight. Existing Project Owner protection remains in force.

Project creation is a separate application-level capability assigned explicitly to active internal Users. Project ownership, Project Access Manager authority and Package Lead authority do not independently grant Project creation. The Project overview, New Project route, Server Actions and persistence service must all enforce the same current PostgreSQL authorization. Existing authorized Project creators become the protected Owner of Projects they create through the established creation workflow.

A Project Owner may designate a **Project Access Manager** to administer collaborator grants and external access requests without granting ownership or authority to modify protected Project Owners.

A Project Owner or Project Access Manager may designate a **Package Lead** for one Specific Package. Package Leads may manage ordinary collaborators only within that Package and only up to the Package Lead's own implemented module permissions. Package Leads cannot grant Project-wide access, target another Package, elevate themselves, appoint another Package Lead, alter a Project Owner, approve external access, or bypass identity verification. Package Contributors do not receive access-management authority automatically. Governance Tiers 1–4 remain operational escalation structures and are not authorization roles.

## 18.2 Access Management Interfaces

The application will provide:

* **Project → Access Management** for protected Owners and authorized Project Access Managers; and
* **Package → Access Management** for protected Owners, Project Access Managers and the applicable Package Lead.

These interfaces will use business-friendly labels and compact layouts to show active assignments, scope, module permissions, delegated authority, pending requests and append-only permission history. They must not display internal UUIDs, Entra Object IDs or other technical identity references.

The internal Access Management workflow allows an authorized administrator to select an existing active, authenticated internal application User by name or email, choose an approved scope, assign implemented module permissions, and optionally designate the User as Project Access Manager or Package Lead. Arbitrary email entry and identity matching by email are not permitted. If the intended person has no validated application identity, they must first sign in through Microsoft Entra.

Project Owners may manage all internal grants. Project Access Managers may manage ordinary collaborators and Package Leads but cannot appoint, modify or remove a Project Access Manager or alter protected Project Owner access. Package Leads may manage only ordinary collaborators within their own Package, cannot modify themselves, and cannot grant more module access than they hold. Removing the final Package Lead is allowed only after an explicit warning and confirmation that the Package will have no designated Lead.

Package Access Management distinguishes direct Package permissions from inherited Entire Project permissions. The effective permission is the highest positive applicable permission. Editing or revoking a direct Package grant never changes a broader Entire Project grant, and the application does not implement negative permission overrides.

## 18.3 Application Collaborators and External Approval

Application collaborators use Microsoft Entra and Better Auth with stable verified PostgreSQL User identities. Existing authenticated Users may receive active grants directly. A proposed external collaborator remains inactive until a Project Owner or Project Access Manager approves the requested scope and permissions and the approved request is securely linked to a verified Microsoft identity. Email matching alone is insufficient, and administrators must not manually enter Entra Object IDs.

External requests record the collaborator's name, email, organization, requested scope, requested modules and permissions, requester and request date, PM decision and date, and identity-link/onboarding status. Microsoft Graph B2B invitation automation is not part of the initial implementation.

Gate Approver email OTP authentication remains independent. An OTP session authorizes only its exact frozen Review Cycle assignment and never creates a persistent Project or Package grant.

## 18.4 Phased Rollout and Shared Architecture

The permission schema and server-only authorization service are shared foundations for future Registers and modules. A module must not become assignable until its routes, queries and mutations enforce the corresponding permission.

The initial rollout is deliberately phased:

1. PostgreSQL access-grant, permission and request persistence plus the shared authorization service;
2. Project and Package Access Management interfaces and delegated authority;
3. full server-side integration of the central Action Register with fixed Package views;
4. external request approval and verified identity onboarding; and
5. final migration, security and historical-compatibility verification.

Only the **Actions** module is initially assignable. The central Action Register enforces live Actions permissions server-side for every read and mutation. Project Owners retain implicit full Actions access without an `access_grant`; migration-created legacy editor and viewer grants retain their approved Read & Write and Read compatibility. No Actions assignment grants access to Project overview data, Gate workflows, Deliverables, Budget or another operational module. External requests and onboarding remain deferred.

An authenticated User with Actions Read may open the Project Action Register and see the aggregation of only the Overall Project and Package scopes for which that permission is effective. Counts, search results, filters, Action details, comments, history and linked labels must be derived only from those authorized Actions. A Package Action Register is a fixed view of the same central data and exposes only its authorized Package. Package-only navigation may identify the Project and Package by number and name but must not expose unrelated Project metadata, Packages or operational routes.

Actions Read & Write is required for creation, field changes, comments, status changes, closing, reopening, deletion, assignment changes and record linking. Authorization is re-evaluated from current PostgreSQL state in the mutation transaction. A non-Owner moving an ordinary Action between scopes requires Read & Write in both source and destination; a Project Owner may move it to any valid Project scope. A fixed Package view rejects every move outside that Package regardless of other permissions. Revocation takes effect on the next read or mutation.

Gate Action creation requires both the existing Gate workflow authority and Actions Read & Write in the Gate's fixed scope. Project Gate Actions are always Overall Project scoped, while Package Gate Actions are always scoped to their Gate Package. Their scope cannot be changed manually. Actions permission does not grant Gate submission, approval, withdrawal or Stage progression authority, and all frozen Review Cycle evidence, decision references, reconciliation and deletion protections remain authoritative.

## 18.4.1 Full Package Access and Governance

The implemented Package modules are **Overview**, **Deliverables**, **Gate Reviews** and **Actions**. A module becomes assignable only after every related Package route, loader and mutation enforces its live PostgreSQL permission. Other schema modules remain unavailable until their own server-side integration is complete.

A Package Lead is an active internal User with a Specific Package grant, `package_lead` authority and Read & Write permission for every implemented Package module. This provides full operational access to that Package without granting access to Overall Project information or another Package. Project Owners retain implicit full Package access. Project Access Manager authority does not itself grant Package operational access.

Ordinary Package Contributors receive only their explicitly assigned positive module permissions. Read and Read & Write are independent per module: for example, Actions Read does not grant Deliverables access, and Deliverables Read & Write does not grant Actions mutation access. Contributors receive no delegated administration, Gate withdrawal or Gate reopening authority merely through module permissions.

Overview Read permits the Package overview and supported Package details; Overview Read & Write permits editing supported Package details. Deliverables permissions control Package Deliverables and the Package Applicability Matrix. Gate Reviews permissions control Package Gate preparation and review administration. Actions permissions retain the central fixed-Package Action Register behavior. Package Gate Action creation requires both Gate Reviews Read & Write and Actions Read & Write for the exact Package.

An active internal Package Lead with Gate Reviews Read & Write for the exact Package may prepare and submit Package Gates, configure Package Gate Approvers, confirm the Package Applicability Matrix review, reopen the immediately preceding eligible approved Package Gate and retry permitted invitations. Reopening requires a reason and performs the single permitted one-Stage backward transition. Formal approval and signature remain independent and require an exact frozen approver assignment and the existing authenticated Review workflow.

The same Package Lead may use the existing withdrawal workflow for an active submitted Package Review Cycle, including after partial approval. Withdrawal requires the existing reason and preserves recorded responses, frozen evidence, actor, timestamp, reason, pending-approval cancellation and creation of a new Review Cycle on resubmission. Gate withdrawal returns the Gate to Not Submitted and does not change the Package Stage.

There is no separate Package Stage rollback operation. A Project Owner or the exact active internal Package Lead with Gate Reviews Read & Write may move a Package backward only by reopening its immediately preceding eligible approved Gate. Package Leads cannot alter the Project Stage, another Package or an earlier approved Gate.

External collaborators and ordinary Package Contributors do not receive Package Lead withdrawal or Gate reopening authority automatically. Package deletion, Project-level governance, Project-level Gate workflows and Project Stage transitions remain separately protected.

Package-only reads use Package-scoped projections. They may disclose the Project number and name for context but must not disclose the Project Budget, Overall Project Actions, other Packages, confidential Project governance, unauthorized documents or unrelated Gate information.

Navigation uses the labels **All projects**, **Current project** and **Current package** consistently. Destinations are rendered only when currently authorized. All projects may show restricted Project and Package entry points, Current package opens the authorized Package overview, and Current project is omitted when the User lacks Project overview authority. Duplicate links to the page already being viewed are avoided.

On **All projects**, a delegated Package with Overview access uses one **Open package** entry point to its authorized Package overview instead of separate module buttons. An Actions-only User without Package Overview access retains one minimal authorized Action Register link. This navigation simplification must not broaden the User's effective permissions.

Deliverable status styling is consistent on Project and Package Gate cards and Applicability Matrix views: Completed is green, Not Started and In Progress are amber, and Not Applicable is neutral grey. The styling applies to collapsed and expanded records and does not alter applicability or completion data.

## 18.5 SharePoint Permission Synchronization — Future

The application should eventually be capable of translating approved access configuration into corresponding SharePoint access.

Example:

Supplier A
→ Project PRJ-017
→ Package PKG-001
→ Supplier role

may receive access to appropriate shared PKG-001 SharePoint content without receiving access to:

* internal Package information;
* commercial information not intended for the supplier;
* unrelated Packages;
* internal Project Risks;
* internal Decisions;
* confidential Project information.

## 18.6 SharePoint Permission Architecture — Future

The technical architecture should prefer manageable permission structures such as:

* SharePoint groups;
* Microsoft 365 / Entra ID groups where appropriate;
* controlled Document Libraries;
* controlled shared areas;
* appropriate folder boundaries.

The solution should avoid excessive unique permissions on individual files where a cleaner group/library/folder-based model is possible.

## 18.7 Application and SharePoint Permissions

Application permissions and SharePoint permissions should remain consistent.

However, application authorization must not rely only on SharePoint permissions.

The application must independently enforce access to structured Project information.

Likewise, direct SharePoint access should not unintentionally bypass required Document restrictions.

---

# 19. Project Controls and Baselines

Core Project Controls include:

* Scope
* Cost / Budget
* Schedule
* Risk
* Change

Scope, Cost and Schedule should support formal baselines.

The system should distinguish where relevant between:

* Original Baseline
* Approved Changes
* Current Approved State
* Forecast
* Actual

Example for Cost:

Original Approved Budget

* Approved Cost Changes
  = Current Approved Budget

Example for Schedule:

Original Baseline Date

* Approved Schedule Changes
  = Current Approved Date

Baselines are approved states against which future Change and performance can be measured.

Version history alone should not be treated as equivalent to formal baseline/change control.

---

# 20. Budget and Cost Control

Each Project should contain one central Project Budget / Cost Control structure.

The Project Budget is the single source of truth for financial Project information.

The system should eventually support:

* Original Approved Budget;
* Approved Changes;
* Current Approved Budget;
* Purchase Orders;
* Commitments;
* Actual Costs;
* Forecast at Completion;
* Contingency;
* Remaining Budget;
* Variance.

Budget lines should allow categorization.

Example categories may include:

* Equipment
* Engineering
* Installation
* Electrical
* Automation
* Construction
* Validation
* External Services
* Contingency

Budget lines should also be capable of association with Packages where applicable.

Conceptually:

Project Budget
→ Budget Lines
→ optional Package association
→ Package financial view

A Package therefore does not maintain an independent Budget.

The same Budget information may be viewed from different perspectives:

* overall Project Budget;
* Package financial view;
* Budget category;
* supplier/commitment view;
* Forecast/Actual view.

These are different views of the same underlying financial data.

## 20.1 Internal Packages

For Internal Packages, the Cost model should eventually be capable of distinguishing where relevant between:

* purchased materials/components;
* external services;
* internal Resource Cost;
* other Package Costs.

The exact treatment of Internal Resource Cost should be developed together with the Resource Planning model.

## 20.2 External Packages

For External Packages, Cost information may include:

* supplier quotation;
* negotiated value;
* Purchase Order / commitment;
* Approved Changes;
* Actual Costs;
* Forecast.

## 20.3 Budget Files and Excel

The Project Budget should eventually be structured application data rather than being dependent on a specific Excel workbook, spreadsheet tab, cell or cell range.

Excel may still be supported for:

* import;
* export;
* reporting;
* analysis;
* offline sharing where required.

Generated Budget reports or exports may be stored in SharePoint.

Supporting financial Documents such as:

* quotations;
* Purchase Orders;
* contracts;
* commercial approvals

may also be stored in SharePoint and referenced from relevant Budget or Procurement records.

An Excel Budget file should not become a second financial source of truth alongside the application.

## 20.4 Baseline Principle

Budget Control should follow:

Original Approved Budget

* Approved Cost Changes
  = Current Approved Budget

The Current Approved Budget can then be compared with:

* Commitments;
* Actual Costs;
* Forecast at Completion.

Package financial views should follow the same principle by aggregating relevant Budget lines associated with that Package.

---

# 21. Schedule, Planning and Microsoft Project Integration

The application should provide high-level Schedule and milestone control.

The Project should have one Master Schedule / master milestone structure.

Packages may have:

* Package milestones;
* supplier schedules;
* internal execution schedules;
* detailed Package schedules.

Package schedules should feed or relate to the Master Schedule rather than replace it.

Initial application focus should remain on milestone and high-level Schedule Control rather than building a full detailed scheduling engine.

Typical milestones may include:

* Project approval
* Design freeze
* RFQ
* PO placement
* FAT
* Delivery
* Installation start
* Mechanical completion
* Commissioning start
* SAT
* Equipment Handover
* Qualification
* Final Acceptance
* Project Closure

## 21.1 Microsoft Project Integration

Microsoft Project may be used as the detailed planning/scheduling system while the CAPEX application remains the source for Project governance and Project Controls.

Potential future integration may include:

* importing milestones;
* linking Project and Package milestones to Microsoft Project activities;
* synchronizing planned dates;
* synchronizing Forecast dates;
* synchronizing Actual dates;
* storing Microsoft Project task IDs;
* linking Packages to groups of Microsoft Project activities;
* reflecting Schedule information in the Project Dashboard;
* using Microsoft Project data for Gate and milestone monitoring.

The application should avoid requiring users to manually maintain identical Schedule information in both systems.

The exact integration method and synchronization direction should be defined later.

Internal Package Resource Planning and Package Schedule information should eventually use compatible time periods so Resource demand can be understood in relation to Project execution dates.

---

# 22. Master Registers

The Project should contain centralized master Registers.

At minimum:

* Action Register
* Risk Register
* Issue Register
* Change Register
* Decision Register
* Interface Register

There should NOT be independent duplicate Registers for every Package.

Individual records may be associated with:

* no Package;
* one Package;
* multiple Packages.

Package pages should display filtered views of Project master Registers.

Records should also support association with the appropriate Governance Tier where applicable.

---

# 23. Governance Tiers and Escalation

Each Project should support a configurable Governance Tier structure.

Governance Tiers represent the Project's execution, meeting, Decision and escalation structure.

The number, names and meaning of Tiers must be configurable per Project.

Example:

### Tier 1 — Package Execution Team

Typical participants:

* designers;
* engineers;
* programmers;
* Package execution team.

### Tier 2 — Project Team

Typical participants:

* Project Manager;
* Package owners;
* discipline leads;
* core Project team.

### Tier 3 — Cross-Functional Customer Team

Typical participants:

* Production;
* Quality;
* Maintenance;
* Logistics;
* Engineering;
* Validation;
* other relevant functions.

### Tier 4 — Steering Committee / Higher Management

Typical participants:

* Project Sponsor;
* senior management;
* Decision makers.

This example must NOT be hard-coded.

A Governance Tier should eventually support:

* Tier number / sequence
* Tier name
* Description
* Typical participants
* Meeting type/cadence
* Decision authority
* Escalation target

## Project Governance Tier Configuration

Governance Tiers should be configured once at Project level and reused consistently throughout the Project.

The Project Governance Tier configuration is the single source of truth for Governance Tier references used by Project governance records.

The configured Tiers should eventually be used by:

- Actions;
- Risks;
- Issues;
- Decisions;
- Changes / MOCs;
- Interfaces where applicable;
- Meetings;
- escalation workflows.

Individual modules must not maintain separate or hard-coded Tier definitions.

Each Tier should have a stable internal identifier so existing records remain linked correctly if the Tier name or description is changed.

The order of the Tiers represents the governance/escalation hierarchy.

Example:

Tier 1 — Package Execution Team  
→ Tier 2 — Project Team  
→ Tier 3 — Cross-Functional Team  
→ Tier 4 — Steering Committee

This example is illustrative only and must not be hard-coded.

A Project may have a different number of Tiers, different Tier names and a different governance structure.

Tiers that are already referenced by current or historical Project records should not be permanently deleted in a way that breaks traceability.

Where a Tier is no longer used, the architecture should eventually support deactivation/archiving so that:

- the Tier is no longer available for new assignments;
- historical references remain intact.

The configured Governance Tiers should represent the structured application implementation of the approved Project Governance & Escalation Plan.

---

# 24. Tier Association and Escalation

Where relevant, Project Register records should have a Current Tier.

This should apply at minimum to:

* Actions
* Risks
* Issues
* Decisions
* Changes

It may also apply to Interfaces and other governance records.

The application should eventually support escalation history.

Example:

Created at Tier 1
→ Escalated to Tier 2
→ Escalated to Tier 3
→ Resolved at Tier 3

Escalation history should preserve:

* previous Tier;
* new Tier;
* escalation date;
* escalated by;
* reason/comment.

Tier escalation should not create duplicate records.

Governance Tier should remain separate from:

* Package association;
* Visibility;
* priority;
* status;
* owner.

---

# 25. Actions

A centralized Action Register should exist per Project.

Typical fields:

* Action ID
* Description
* Owner
* Created date
* Due date
* Priority
* Status
* Source
* Scope — Overall Project or one Related Package
* Current Governance Tier
* Related Stage
* Related Meeting
* Related Risk/Issue
* Related Deliverable
* Related Requirement
* Visibility
* Comments
* Closure date

Every Action belongs to one Project and is scoped either to the Overall Project or to exactly one Package. The application must maintain one central Action Register per Project; Package Action Registers are fixed, authorized views of that central register rather than separate databases.

The Project Action Register aggregates only scopes where the current User has Actions Read. Its totals, quick views, searches and filter options must not include unauthorized Actions or Packages. The Package Action Register uses the same interface and business logic with its Package scope fixed for reads, creation and editing. Read-only Users may inspect Action details, comments and history but must not receive mutation controls.

Ordinary Action scope changes require current Read & Write access to both source and destination unless the acting User is the protected Project Owner. Gate Action scope is immutable: a Project Gate Action remains Overall Project scoped and a Package Gate Action remains associated with exactly its Gate Package. Multiple Package associations are invalid and must be rejected by the interface, application service and PostgreSQL constraints.

Actions should be easy to create and update.

Overdue Actions should be immediately visible.

Actions may be escalated between Governance Tiers without duplication.

---

# 26. Visibility and Access

Object association and object Visibility are separate concepts.

Future Visibility levels may include:

* Internal
* Project stakeholders
* Package stakeholders
* Selected users/groups

External Package stakeholders should only see information for which they have appropriate Visibility.

Do not assume that all information associated with a Package is automatically visible to its supplier.

Visibility should remain separate from Governance Tier.

Application Visibility rules should also be considered when Documents are exposed through SharePoint.

---

# 27. Risks and Issues

Risks and Issues should be managed separately but consistently within Project master Registers.

A Risk or Issue may relate to:

* the overall Project;
* one Package;
* multiple Packages.

## 27.1 Risk

Typical fields:

* Risk ID
* Description
* Cause
* Consequence
* Probability
* Impact
* Risk score
* Mitigation
* Owner
* Due date
* Related Package(s)
* Current Governance Tier
* Visibility
* Status

## 27.2 Issue

Typical fields:

* Issue ID
* Description
* Impact
* Owner
* Corrective Action
* Due date
* Related Package(s)
* Current Governance Tier
* Visibility
* Status

Risks and Issues should be capable of escalation between Governance Tiers while remaining the same underlying record.

The scoring methodology should remain configurable rather than deeply hard-coded.

---

# 28. Change Management

Projects should contain a centralized Change Register.

A Change should be able to capture:

* Change ID;
* description;
* reason;
* requester;
* date;
* affected Package(s);
* Current Governance Tier;
* affected Requirements;
* technical impact;
* Scope impact;
* Cost impact;
* Schedule impact;
* approval status;
* Decision;
* implementation status;
* Visibility.

Approved Changes should update the Current Approved State while preserving the Original Baseline.

Change Management should link where relevant to:

* Scope;
* Budget;
* Schedule;
* Requirements;
* Documents;
* Packages.

Changes may be escalated through Governance Tiers depending on Decision authority.

---

# 29. Decisions

The Project should contain a centralized Decision Register.

Typical fields:

* Decision ID
* Description / Decision required
* Context
* Decision
* Decision owner
* Decision date
* Related Package(s)
* Current Governance Tier
* Related Action(s)
* Related Risk/Issue
* Related Change
* Visibility
* Status

A Decision may originate at one Tier and be escalated to a higher Tier.

The Decision history should remain traceable.

Important Package Decisions such as Internal/External Execution Model selection should eventually be traceable through the Decision architecture.

---

# 30. Interfaces

Multi-Package Projects require explicit Interface Management.

The Project should eventually contain an Interface Register.

Typical fields:

* Interface ID
* Description
* From Package / party
* To Package / party
* Interface type
* Responsibility
* Owner
* Due date
* Current Governance Tier where applicable
* Status
* Related Requirement(s)
* Related Document(s)
* Visibility

Examples:

* mechanical transfer between Filler and Conveyor;
* electrical supply boundary;
* automation handshake;
* MES Interface;
* utility connection;
* civil/equipment Interface.

Interfaces may involve multiple Packages and should remain Project-level records with Package associations.

---

# 31. Requirements and V-Model Traceability

The application should support a V-model-like Requirements and Verification approach.

Requirements should eventually become structured application objects rather than existing only inside a Document.

The controlled URS Document may still exist in SharePoint as a formal Project Document.

Requirements should support unique identifiers such as:

* URS-001
* URS-002
* URS-003

A Requirement may apply to:

* the overall Project;
* one Package;
* multiple Packages.

The application should eventually support:

Requirement
→ Design Reference
→ FAT
→ SAT
→ IQ / OQ / PQ where applicable
→ Verification Evidence

The exact Verification method should not be hard-coded.

A Requirement may be verified by one or several activities.

Verification evidence may be stored as Documents in SharePoint while the structured Verification relationship/status is maintained by the application.

Supplier FAT/SAT evidence may be referenced by later qualification activities.

The application should avoid assuming that FAT equals OQ or SAT equals IQ.

---

# 32. Requirements Traceability Matrix

The RTM should eventually be generated from structured application data rather than maintained as a separate duplicate Excel master.

The RTM should be a Project-level source of truth.

Package pages may display filtered RTM views.

The application should eventually make it possible to understand:

* which Requirements are defined;
* which Packages they apply to;
* how they are implemented;
* how they will be verified;
* which SharePoint evidence supports Verification;
* whether Verification has been completed;
* whether deviations remain open.

---

# 33. Meetings

The application should eventually support Project and Package Meetings.

A Meeting can contain:

* date;
* Meeting type;
* Governance Tier;
* attendees;
* Related Package(s);
* notes;
* Decisions;
* Actions.

Meetings may be associated with Governance Tiers.

Example:

Tier 1
→ Package Execution Meeting

Tier 2
→ Project Team Meeting

Tier 3
→ Cross-Functional Project Review

Tier 4
→ Steering Committee

Actions created during Meetings should become normal records in the Project Action Register.

Decisions should become records in the Project Decision Register.

---

# 34. Tier-Based Meeting Views

Governance Tiers should eventually support filtered Meeting views.

A Tier Meeting should be able to display relevant:

* open Actions;
* Risks;
* Issues;
* Decisions required;
* Changes awaiting Decision;
* Interfaces requiring escalation;
* recently escalated items.

These should be views of the same master Register records rather than separate Meeting lists.

---

# 35. Project Dashboard

Each Project should have a concise management Dashboard.

The Dashboard should answer quickly:

* Where are we overall?
* What Project Stage are we in?
* Which Packages are in which Stages?
* Which Packages are Internal/External/undecided?
* Are we on Schedule?
* Are we within Budget?
* What requires attention?
* What are the major Risks/Issues?
* What Actions are overdue?
* Which Deliverables are late?
* What are the next major milestones?
* Which Gates are approaching?
* What Changes are pending?
* What items are escalated?
* What requires attention at each Governance Tier?
* What is the Requirements/Verification status where applicable?
* What internal Resource demand exists where relevant?

Information should not have to be manually entered twice purely for Dashboard reporting.

Do not calculate a Project percentage complete simply from Package Stages.

---

# 36. Package Overview

The Project should provide a clear Package Overview.

Typical columns may include:

* Package code/name
* Package owner
* Execution Model
* Awarded supplier where applicable
* Current Stage
* Status
* financial summary derived from Project Budget where appropriate
* Target date
* Next Gate
* Key milestone

Before Execution Model selection, Execution Model may display:

* Not determined

This represents an unset state, not a third Execution Model.

Before Contract Award, an External Package may show:

* tender candidates;
* preferred supplier

instead of an awarded supplier.

Package rows should provide intuitive navigation to Package details.

The purpose is to make asynchronous Package progress immediately visible.

---

# 37. Package Detail

Each Package should eventually have a dedicated detail view.

Potential sections/tabs:

* Overview
* Lifecycle
* Deliverables
* Documents
* Actions
* Risks & Issues
* Requirements
* Interfaces
* Milestones
* Execution Strategy
* Suppliers / Tender Candidates where relevant
* Resource Plan where relevant
* Commercial / Cost

Where information originates from a Project master Register, the Package view should display a filtered view rather than duplicate records.

The Documents view should provide an application interface to relevant SharePoint Documents.

Internal Packages should emphasize Resource Planning where applicable.

External Packages should emphasize supplier/procurement information where applicable.

---

# 38. Portfolio Dashboard

A higher-level Dashboard should eventually provide an overview across Projects.

Possible information:

* active Projects;
* Project Stages;
* Project status;
* Budget status;
* Schedule status;
* major Risks;
* upcoming milestones;
* upcoming Gates;
* Package delivery status;
* escalated items;
* internal Resource capacity/demand where appropriate.

Portfolio functionality should remain lightweight until multi-Project management becomes necessary.

---

# 39. Cross-Project Resource Planning

The Portfolio level should eventually support consolidated Internal Resource Planning.

Resource Planning is primarily relevant to Internally executed Packages.

The objective is to consolidate Resource demand from Internal Packages across multiple Projects so the organization can understand:

* Resource occupancy;
* available capacity;
* future demand;
* over-allocation;
* under-allocation;
* discipline bottlenecks;
* conflicts between Projects;
* timing of required engineering capacity.

## 39.1 Resource Planning Source

Resource demand should primarily originate from Internal Package Resource Plans.

Conceptually:

Portfolio
→ Projects
→ Internal Packages
→ Package Resource Plans
→ Consolidated Resource Occupancy Plan

A Resource allocation should retain traceability to:

* Project;
* Package;
* discipline;
* Resource or Resource pool;
* time period;
* planned allocation.

The Portfolio Resource Plan should be a consolidation of underlying Package Resource Plans rather than an independent duplicate planning system.

## 39.2 Resource Disciplines

Typical Resource disciplines may include:

* Project Management;
* Mechanical Engineering;
* Electrical Engineering;
* Automation / PLC;
* Robotics;
* Process Engineering;
* Validation;
* Quality;
* Commissioning;
* other configurable disciplines.

The discipline list should eventually be configurable.

## 39.3 Capacity Planning Before Named Resource Assignment

Resource Planning should support planning before individual people have been assigned.

Example:

PKG-004 Automation:

* Automation Engineering: 1.5 FTE
* Electrical Engineering: 0.5 FTE

This allows future demand to be forecast at discipline/resource-pool level.

Later, planned capacity may be assigned to named Resources.

Example:

Automation Engineering — 1.5 FTE

becomes:

* Engineer A — 0.8 FTE
* Engineer B — 0.7 FTE

The architecture should therefore distinguish between:

* Resource demand;
* Resource assignment.

## 39.4 Named Resources

Where individual Resource Planning is required, a Resource should eventually support information such as:

* Resource ID
* Name
* Discipline(s)
* Team/department
* available capacity
* active/inactive status
* relevant skills where useful

Detailed HR information is outside the intended Scope of the application.

The application should not become an HR system.

## 39.5 Resource Capacity

Resource capacity and Project allocation are separate concepts.

Example:

An engineer may theoretically represent 1.0 FTE but only have 0.8 FTE available for CAPEX Project work because remaining capacity is required for:

* support;
* operational tasks;
* management;
* training;
* other non-Project activities.

The system should eventually allow usable Project capacity to be represented independently from Project allocations.

## 39.6 Resource Allocation

Internal Package Resource Plans should eventually support time-phased allocation.

The exact planning granularity should be defined later.

Possible periods include:

* week;
* month.

An allocation may eventually contain:

* Project;
* Package;
* Resource discipline;
* named Resource where assigned;
* start/end period;
* planned FTE or percentage allocation.

## 39.7 Consolidated Resource Occupancy

The application should eventually consolidate allocations across Projects.

Example:

Engineer A:

* Project A / PKG-003 — 40%
* Project B / PKG-007 — 50%
* Project C / PKG-002 — 30%

Total occupancy:

120%

The Portfolio Resource Planning view should make over-allocation clearly visible.

The same principle should work at discipline level.

Example:

Automation capacity:

Available: 6.0 FTE
Planned demand: 7.5 FTE
Capacity gap: 1.5 FTE

## 39.8 Relationship to Make-or-Buy Decision

Resource Planning may support the Internal-versus-External execution Decision.

During Definition or Tendering, the Project team may estimate the internal Resource demand required to execute a Package.

This Resource demand may be compared with:

* available internal capacity;
* external supplier Cost;
* internal Cost;
* Schedule;
* technical capability;
* Risk;
* strategic considerations.

Before Internal execution is approved, such Resource demand may be considered provisional/planning demand.

Once Internal execution is approved, the Resource Plan can become committed Project demand.

The exact distinction between provisional and committed Resource demand should be defined when the Resource Planning module is designed.

## 39.9 Project-Level Resources

Although engineering Resource Planning primarily originates from Packages, some Resources may operate directly at Project level.

Examples:

* Project Manager;
* Project Engineer;
* Validation Lead;
* overall Commissioning Lead.

The architecture should therefore eventually allow Resource allocations to relate either to:

* a Project; or
* a specific Package.

Package-level allocation should remain the preferred level for Resources performing Package execution work.

## 39.10 Scope Boundary

Resource Planning should remain focused on CAPEX Project capacity and occupancy.

It should NOT become:

* payroll;
* time registration;
* leave management;
* employee performance management;
* a full HR planning system.

The purpose is to answer:

> What internal Resource capacity do our CAPEX Projects require, when is it required, and do we have sufficient capacity to execute the planned Portfolio?

---

# 40. Reporting

Reports should be generated as much as possible from existing Project information.

Potential reports:

* Project Status Report
* Steering Committee Report
* Gate Review
* Budget Overview
* Package Overview
* Action Overview
* Risk Overview
* Change Overview
* Decision Overview
* Milestone Overview
* Requirements/Verification Overview
* Supplier/Package Performance Report
* Tier Meeting Overview
* Internal Resource Plan
* Portfolio Resource Occupancy Report

Avoid requiring users to manually recreate information already stored in the application.

Reports generated as files may be stored in the relevant SharePoint Project structure where appropriate.

---

# 41. Project Handover and Archive

Completed Projects must remain understandable and usable after active Project execution has ended.

The application should support generation of a structured final Project Archive using:

* structured data from the CAPEX application;
* final/as-built Documents stored in SharePoint.

## 41.1 Internal Project Archive

May contain:

* Project Summary;
* final Project Scope;
* final/as-built Layout;
* final Schedule and milestone information;
* final Budget summary;
* Package information;
* final Action Register;
* final Risk Register;
* final Issue Register;
* final Change Register;
* Decision Register;
* Interface Register;
* Requirements Traceability;
* Validation information where applicable;
* Lessons Learned;
* Post-Mortem;
* supplier performance information;
* relevant final/as-built Documents.

## 41.2 Customer Handover Package

A Customer Handover Package should contain a controlled subset.

Typical content:

* approved as-built drawings;
* final Layouts;
* Technical Specifications;
* relevant Requirements;
* FAT/SAT documentation;
* manuals;
* certificates;
* training documentation;
* spare-parts information;
* Validation documentation where applicable;
* final Package documentation;
* contractual handover Deliverables.

Internal/confidential information should not automatically be included.

## 41.3 Archive Generation

Potential Archive types:

* Internal Archive
* Customer Handover
* Custom Archive

Selection options may include:

* Packages;
* Document categories;
* final revisions only;
* Register exports;
* Validation documentation;
* other relevant Project information.

The application should retrieve required files from SharePoint and combine them with exported structured Project information.

## 41.4 Archive Manifest

A generated Archive should contain an index/manifest identifying:

* Project;
* Archive generation date;
* Archive type;
* included Packages;
* included Documents;
* Document revisions;
* relevant metadata;
* Archive structure.

## 41.5 Portability

The final Archive must remain understandable without requiring continued access to the CAPEX application.

Where practical, final information should use standard human-readable or commonly supported formats.

---

# 42. Status Indicators

Where useful, information may use:

* Green
* Amber
* Red
* Not assessed

Status should preferably be calculated from underlying information where sensible.

The system should avoid excessive manual status administration.

A manually entered Overall Project Status should not be required if meaningful status can be derived.

---

# 43. Traceability and Audit History

Important Project Decisions, approvals, baselines, escalations, lifecycle routing, permission changes and status changes should be traceable.

Over time the system should support understanding:

* what changed;
* when;
* who changed it;
* why;
* what was approved;
* which baseline applied;
* which Change authorized a modification;
* at which Governance Tier an item was managed;
* when and why it was escalated;
* why a Stage was skipped;
* when Internal/External execution was selected;
* relevant access/permission changes where required.
* which Gate Review authorized a Stage transition;
* which Approvers approved or rejected a Gate;
* in which approval role each person acted;
* which exact Document revisions/versions were reviewed and approved;
* which baseline versions were established by a Gate;
* which subsequent MOCs changed an approved baseline;
* the complete history of Gate Review cycles, including rejected, reopened and superseded reviews.

The implementation depth of audit history should grow only when required.

---

# 44. UX Requirements

The application should be optimized for frequent use by a Project Manager.

Important principles:

* minimal clicks;
* fast data entry;
* clear tables;
* powerful filtering;
* useful sorting;
* consistent status indicators;
* clear navigation;
* easy movement between Project and Package levels;
* easy access to SharePoint-backed Documents;
* easy identification of Project-level versus Package-level information;
* easy filtering by Governance Tier;
* clear escalation visibility;
* avoid unnecessary duplication;
* make asynchronous Package progress easy to understand.

Desktop usage is the primary use case.

Responsive behaviour is desirable.

On normal desktop/laptop screens, primary overview tables should fit within the available content area wherever reasonably possible without requiring horizontal scrolling.

Users should be able to open Projects and Packages intuitively from their overview rows rather than requiring unnecessary dedicated `Open` columns where row navigation is appropriate.

The application should be usable through modern web browsers without requiring dedicated desktop software for normal use.

Users should not need to understand whether information is technically stored in:

* the application database;
* SharePoint;
* Microsoft Project

during normal use.

Concepts such as:

* Scope level;
* Package associations;
* Visibility;
* Governance Tier;
* Execution Model;
* Resource allocation

should be translated into intuitive UI.

---

# 45. Navigation Concept

Possible application-level navigation:

Dashboard
Projects
Portfolio
Resources
Settings

Within a Project:

Overview
Packages
Lifecycle / Gates
Deliverables
Documents
Requirements / Traceability
Actions
Risks & Issues
Changes
Decisions
Interfaces
Budget
Schedule
Resources
Meetings
Stakeholders / Access
Reports

Within a Package:

Overview
Lifecycle
Execution Strategy
Deliverables
Documents
Actions
Risks & Issues
Requirements
Interfaces
Milestones
Suppliers / Tender Candidates — where relevant
Resource Plan — where relevant
Commercial / Cost

This navigation is a target concept and should evolve based on actual usage.

Do not implement navigation items before corresponding functionality exists.

---

# 46. Technical and Non-Functional Requirements

The application is intended to become a production-capable web application containing important Project information.

Its architecture should therefore support appropriate:

* availability;
* security;
* performance;
* persistence;
* backup;
* recovery.

These Requirements describe capabilities rather than prescribing a specific hosting provider or technology.

## 46.1 Hosting and Accessibility

The production application should be capable of being hosted in a professional cloud environment.

Authorized users should be able to securely access the application through a modern web browser from different locations.

Normal use should not depend on:

* the developer's computer;
* a specific Project Manager's computer;
* a local development environment;
* a permanently running local server.

Development, testing and production environments should eventually be separable.

The exact hosting platform should be selected later.

## 46.2 Structured Data Storage

PostgreSQL is the authoritative source of truth for operational structured application data. Operational records must not be persisted in parallel JSON files or depend on the local filesystem of the application runtime.

This includes:

* Projects;
* Packages;
* suppliers;
* stakeholders;
* Resources;
* Resource Plans;
* Governance Tiers;
* Gates;
* Deliverables;
* Actions;
* Risks;
* Issues;
* Changes;
* Decisions;
* Interfaces;
* Requirements;
* Traceability;
* milestones;
* Cost information;
* permissions configuration;
* Document metadata and SharePoint references;
* audit/history information.
* Deliverable applicability decisions, justifications and change history.

Application data must not depend on temporary application memory or the local filesystem of the application runtime.

## 46.3 Document Storage

SharePoint should be the primary Document/file-storage backend.

The application should not create a parallel Document repository unless required for temporary technical processing.

Actual persistent Project Documents should normally remain in SharePoint.

## 46.4 Authentication

Production Project information must require authenticated access.

The architecture should allow integration with enterprise identity management.

Given SharePoint integration, Microsoft enterprise identity integration should be considered during technical architecture design.

## 46.5 Authorization

Being authenticated must not automatically provide access to all Project information.

Authorization should consider:

* organization;
* Project membership;
* Project role;
* Package membership;
* stakeholder group;
* Visibility;
* user/group-specific access where required.

Authorization must be enforced by the backend and must not rely solely on hiding information in the UI.

## 46.6 Data Security

The architecture should support:

* encrypted HTTPS/TLS communication;
* secure authentication;
* secure secret management;
* secure database access;
* appropriate authorization;
* protection against unauthorized access;
* security-relevant logging where required.

Passwords, API keys and credentials must not be hard-coded into source code.

## 46.7 Data Persistence and Durability

Structured Project information must remain available independently from:

* application restarts;
* deployments;
* server replacement.

SharePoint-backed Documents must remain persistent independently from the application runtime.

## 46.8 Backup and Recovery

Production structured data should be backed up automatically.

The architecture should support recovery from:

* accidental deletion;
* data corruption;
* infrastructure failure;
* application failure.

Where appropriate, database point-in-time recovery or equivalent capability should be possible.

For Documents, SharePoint's appropriate:

* versioning;
* retention;
* recycle/recovery;
* resilience capabilities

should be considered as part of the overall recovery strategy.

A backup strategy must consider actual restoration capability.

Exact:

* backup frequency;
* retention;
* Recovery Point Objective;
* Recovery Time Objective

should be defined later.

## 46.9 Performance

The application should feel responsive during normal Project Management use.

Typical operations such as:

* opening a Project;
* switching between Project and Package views;
* viewing Registers;
* filtering tables;
* opening Dashboards;
* updating records;
* retrieving Document lists;
* viewing Resource Plans

should respond quickly under normal operating conditions.

Large SharePoint Documents should not unnecessarily block normal application interaction.

## 46.10 Availability and Reliability

Temporary failure of an individual application process should not result in permanent Project data loss.

Appropriate monitoring, error logging and diagnostics should eventually be implemented.

## 46.11 External Integration Resilience

The application should handle temporary unavailability of external services such as SharePoint or Microsoft Project gracefully.

For example:

* failure to reach SharePoint should not corrupt Project metadata;
* failed synchronization should be identifiable;
* synchronization should be retryable where appropriate;
* users should receive clear feedback when an external operation fails.

The application should not silently report successful Document creation or permission synchronization if the corresponding SharePoint operation failed.

---

# 47. Data Ownership and Lifecycle

Project data has a lifecycle beyond active Project execution.

The application should distinguish conceptually between:

* Active Projects;
* Closed Projects;
* Archived Projects.

Closing a Project should not delete its structured data or SharePoint Documents.

Closed Project information should remain searchable and accessible to authorized users.

Deletion of Projects or critical Project information should require appropriate controls and explicit confirmation.

The same principle applies to Packages.

Destructive deletion should not occur accidentally through a single unconfirmed user action.

Long-term retention Requirements may vary by:

* organization;
* customer;
* industry;
* regulatory environment

and should therefore remain configurable.

---

# 48. SharePoint Provisioning and Synchronization Principles

SharePoint integration is a core architectural capability.

The exact SharePoint API/integration implementation should be defined during technical architecture development.

The system should eventually support controlled synchronization for:

* Project creation;
* Package creation;
* Document metadata;
* Document creation/upload;
* Document access;
* Stakeholder access;
* permissions;
* Archive generation.

Operations spanning the application database and SharePoint must consider partial failure.

Example:

If a Package is successfully created in the application database but SharePoint Package provisioning fails, the application should not lose the Package or falsely report that SharePoint provisioning succeeded.

Instead, it should be capable of representing a state such as:

* Package created;
* SharePoint provisioning pending/failed;
* retry available.

Similar principles should apply to:

* Project provisioning;
* permission synchronization;
* Document operations.

The application database should maintain stable references to SharePoint resources required for synchronization.

---

# 49. Template Architecture

The application should eventually support configurable Project and Package templates.

Templates may define:

* Project lifecycle;
* Package lifecycle;
* Stage applicability;
* Gates;
* Deliverables;
* Governance Tiers;
* SharePoint structure;
* Document categories;
* default access groups;
* milestone structures;
* Validation applicability;
* Resource disciplines or planning defaults where appropriate.

Templates should allow standardization without making every Project identical.

Creating a Project from a template should eventually be capable of creating both:

* required application structure;
* corresponding SharePoint structure.

Creating a Package from a Package template should eventually do the same.

The Package execution route should remain capable of changing based on Internal/External Decisions rather than being permanently fixed by the template at creation.

---

# 50. Core Domain Principles

The following distinctions are fundamental to the architecture.

## Project vs Package

Project = overall governance, integration and Project Controls.

Package = independently progressing Scope/work package within the Project.

## Package vs Supplier

Package = Scope of work.

Supplier = external organization that may tender for or execute a Package.

They are separate entities.

## Package Execution Model

Execution Model is a Package-level Decision.

There are two Execution Models:

* Internal
* External

Before the Decision is approved, Execution Model may remain unset.

A Project itself is not classified as Internal or External.

## Internal Package

A Package executed primarily using internal organizational Resources.

Internal Packages may create Resource demand that contributes to cross-Project Resource Planning.

## External Package

A Package executed primarily by an external contracted supplier/OEM.

An External Package may have multiple tender candidates but a maximum of one awarded supplier.

## Make-or-Buy Decision

The Decision whether a Package will be executed Internally or Externally.

This Decision may occur:

* during Definition; or
* during Tendering.

## Stage

A period of work within a Project or Package lifecycle.

## Stage Applicability

Not every Package Stage must apply to every Package.

Tendering and Procurement may be skipped when justified by the approved execution route.

Skipping a Stage must remain traceable and must not automatically eliminate Deliverables that remain required.

## Milestone

An important event or target date.

## Gate

A governance Decision authorizing progression.

## Deliverable

Something that must be produced or achieved. Every Deliverable has acceptance requirements that must be satisfied before it may be marked Completed.

## Document

A file/artifact stored primarily in SharePoint that may support or provide evidence for a Deliverable.

## Baseline

An approved state against which future Changes and performance are measured.

## Register

A single Project-level source of truth containing structured records such as:

* Actions;
* Risks;
* Issues;
* Changes;
* Decisions;
* Interfaces.

## Package Association

Defines which Package(s) an object concerns.

## Visibility

Defines who is allowed to see an object.

## Governance Tier

Defines the Project governance/escalation level at which an object is currently managed.

## Resource Demand

The amount of internal capacity required to execute Project or Package work.

## Resource Assignment

The allocation of Resource demand to one or more named internal Resources.

## Resource Capacity

The amount of capacity available for Project work independently from individual Project allocations.

## Portfolio Resource Planning

The consolidated view of internal Resource demand and assignments across Projects and Packages.

## Application vs SharePoint

Application = structured Project Management system of record and primary Project Management interface.

SharePoint = Document/file system of record.

## Application vs Microsoft Project

Application = Schedule governance, milestones and Project Management integration.

Microsoft Project = potential detailed scheduling system.

## Project Archive

A portable final representation of relevant structured Project information and SharePoint Documents intended for:

* long-term retention;
* handover;
* future reference.

Package Association, Visibility and Governance Tier must remain separate concepts.

---

# 51. Development Principle

These Requirements define the long-term target architecture and direction of the product.

They DO NOT authorize implementation of all described functionality.

Development must proceed incrementally.

Each functionality should be:

1. discussed;
2. planned;
3. approved;
4. implemented;
5. tested;
6. evaluated before proceeding to the next feature.

The Requirements document should guide architectural and data-model Decisions so current development does not block future functionality.

However:

> Do not proactively implement future modules merely because they are described in this document.

Only implement functionality explicitly requested in the current development task.

Avoid unnecessary refactoring of working functionality.

Prefer small, testable development increments.

Before implementing a requested feature:

1. inspect the existing application structure;
2. inspect the existing data model;
3. identify the minimum required architectural changes;
4. reuse existing components and patterns where appropriate;
5. explain the proposed change briefly;
6. implement only the approved Scope;
7. verify that existing functionality continues to work.

When future integration is expected, such as:

* SharePoint;
* Microsoft Project;
* enterprise authentication;
* cloud deployment;

design the current architecture so such integration remains possible without prematurely implementing it.

Security, data integrity, recoverability and authorization should be considered from the start when making architectural Decisions.

Documenting future capabilities such as:

* Gates;
* Deliverables;
* Package Execution Models;
* conditional lifecycle routing;
* Stage skipping;
* make-or-buy Decisions;
* Internal Resource Planning;
* Portfolio Resource Planning;
* SharePoint integration

does NOT mean these capabilities should all be implemented immediately.

Current data-model and lifecycle Decisions should, however, avoid assumptions that would prevent these capabilities later.

In particular:

* do not reintroduce a Project-level Internal/External or Supplier-led/Internal classification;
* Internal/External execution is a Package-level concept;
* Package financial information should not become an independent second Budget;
* SharePoint is the intended Document system of record;
* structured Project Management information belongs in the application database;
* future Resource Planning should consolidate underlying Project/Package Resource Plans rather than create a disconnected planning system.
