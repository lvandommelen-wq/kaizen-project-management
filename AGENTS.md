1. Purpose

This repository contains a web-based CAPEX Project Management application.

The application supports the management of large technical CAPEX projects involving engineering, equipment procurement, installation, commissioning, qualification/validation, and handover.

The goal is to create a lean, maintainable tool supporting the management of large technical projects executed through a waterfall / stage-gate methodology (pragmatic version of the Prince2).

Typical projects may involve:

external suppliers or OEMs executing major equipment packages;
internal multidisciplinary engineering teams;
mechanical engineering;
electrical engineering;
automation and software;
external contractors;
commissioning and validation activities.

The application follows a waterfall / stage-gate project-management philosophy.

Development must prioritize:

simplicity;
maintainability;
clear architecture;
efficient use of development time;
efficient use of tokens and context;
incremental delivery;
ease of future modification;
avoiding unnecessary complexity.

The existence of global product requirements does NOT mean all described functionality should be implemented immediately.

Only implement functionality explicitly requested in the current task.

2. Core Development Principle

Develop the application incrementally, one useful capability at a time.

Prefer small, complete vertical increments over large implementations covering multiple future modules.

A typical development sequence may be:

Project
→ Stages
→ Gates
→ Deliverables
→ Actions
→ Risks & Issues
→ Budget
→ Schedule
→ Meetings
→ Changes
→ Dashboard
→ Reporting

This sequence is indicative and may change.

Do NOT implement future functionality simply because it appears in the product requirements.

Each increment should leave the application in a usable and understandable state.

3. Mandatory Plan-First Workflow

For every non-trivial development request, use the following workflow:

Understand → Plan → Approval → Build → Verify

Planning and implementation must remain separate.

Step 1 — Understand

Before proposing a solution:

read the current user request carefully;
inspect relevant existing code;
inspect relevant project documentation;
understand existing patterns before introducing new ones;
identify which parts of the application are affected.

Only inspect files that are reasonably necessary to understand the requested change.

Do NOT scan or analyze the complete repository unless this is necessary.

Do NOT modify application code during this phase.

Step 2 — Plan

Before modifying code, provide a concise implementation plan.

The plan should normally contain:

Objective
What functionality is being added or changed?
Proposed solution
How will it work from a user and technical perspective?
Affected components
Which pages, components, files, database entities, or APIs are expected to change?
Data impact
Are data-model or persistence changes required?
Assumptions
What assumptions are being made?
Impact
Could this affect existing functionality?
Decisions requiring approval
Are there meaningful architectural or UX choices that should be decided before implementation?

Keep the plan proportional to the task.

A simple change requires a short plan.

A significant architectural change requires more detail.

Do not turn planning into unnecessary documentation.

Step 3 — Wait for Approval

Do NOT modify application code until the proposed plan has been approved.

If the user requests changes to the plan, revise the plan first.

Approval authorizes only the scope described in the approved plan.

Do not interpret approval as permission to:

implement related future functionality;
perform unrelated refactoring;
redesign other parts of the application;
introduce additional dependencies without need.
Step 4 — Build

After approval:

implement only the approved scope;
keep changes focused;
follow existing application patterns where appropriate;
reuse existing components where practical;
avoid unrelated refactoring;
avoid unnecessary abstractions;
avoid unnecessary dependencies;
keep the implementation understandable.

If implementation reveals a significant unexpected decision or architectural consequence:

STOP → explain the finding → propose an updated plan → wait for approval.

Do not silently make major architectural decisions during implementation.

Step 5 — Verify

After implementation:

verify the requested functionality;
run relevant build, type, lint, or test checks;
check functionality affected by the change;
check for obvious regressions.

For user-facing functionality, prefer verification of actual behaviour rather than relying only on code inspection.

After verification, provide a concise implementation summary containing:

what changed;
important files/components affected;
verification performed;
any remaining limitation;
suggested next step, if relevant.

4. Planning Mode vs Build Mode

For non-trivial changes, explicitly separate planning behaviour from implementation behaviour.

Planning

During planning:

investigate;
read relevant code;
reason about the solution;
identify dependencies;
identify potential consequences;
propose the smallest useful implementation.

Planning should be read-only.

Do not modify application code.

Building

Building starts only after approval.

During building:

follow the approved plan;
remain within scope;
implement the smallest complete solution;
verify the result.

If the approved plan becomes invalid because of something discovered during implementation, return to planning.

5. Lean Architecture Principle

Use the simplest architecture that satisfies current requirements while allowing reasonable future extension.

Do not build infrastructure merely because it might become useful later.

Avoid premature implementation of:

microservices;
event-driven architectures;
complex workflow engines;
generic rule engines;
complex permission systems;
unnecessary abstraction layers;
enterprise integration frameworks;
AI functionality;
elaborate caching;
premature performance optimization;
unnecessary cloud infrastructure.

Future requirements may influence current design decisions when appropriate, but they must not create unnecessary complexity today.

6. Scope Discipline

For every feature, distinguish between:

REQUIRED

Necessary to deliver the requested functionality correctly.

USEFUL LATER

Potential enhancement that may become useful in a future iteration.

Implement REQUIRED functionality.

Do not normally implement USEFUL LATER functionality unless explicitly requested.

If a future consideration materially affects today's architecture, mention it during planning without implementing it prematurely.

7. Decision Principle

When several technically valid solutions exist, prefer the solution that is:

simplest to understand;
easiest to maintain;
consistent with the existing application;
least disruptive;
sufficient for the current requirement;
easy to modify later.

Do not optimize for hypothetical scale or requirements without a concrete reason.

8. Token and Context Efficiency

Use context efficiently.

For each task:

inspect relevant files first;
use targeted searches instead of reading entire directories;
avoid repeatedly reading unchanged files;
avoid loading unrelated documentation;
summarize findings instead of reproducing large files;
keep plans concise;
keep implementation summaries concise;
avoid unnecessary exploratory work.

Do not perform broad repository analysis unless required.

Do not repeatedly re-read global requirements when only a small known section is relevant.

Use the minimum context required to make a reliable decision.

Token efficiency must never override correctness, but unnecessary context usage should be avoided.

9. Skill Usage

Skills should be used selectively.

Before using a skill, determine whether it materially improves the current task.

Prefer, in order:

project instructions;
existing application patterns;
already installed relevant skills;
specialized skills only when additional expertise is genuinely required.

Do not load unrelated skills.

Do not search for or install new skills merely because they might become useful later.

If a new skill could materially improve a task:

explain why the skill is useful;
propose the skill;
wait for approval before installing it.

Examples of specialized skills that may become relevant later include:

database design;
authentication;
application security;
testing;
deployment;
cloud infrastructure;
ISO / IEC standards;
machinery safety;
specialized data visualization.

Keep skill usage focused to minimize unnecessary context and token consumption.

10. Specialized Agents

The primary development agent should handle normal application development.

Do not automatically delegate work to specialized agents.

Specialized agents should only be used when their expertise materially improves the task.

Examples include:

ISO / IEC standards;
machinery safety;
cybersecurity;
database architecture;
security review;
complex statistical analysis;
specialized UX review.

Preferred sequence:

Primary agent analysis
→ Plan
→ Approval
→ Implementation
→ Verification
→ Specialized review if required

Specialized agents should generally act as reviewers or validators rather than automatically driving implementation.

Avoid using multiple agents to solve a problem that the primary agent can handle efficiently.

11. Standards and Regulatory Information

Do not assume requirements from standards or regulations.

Examples include:

ISO;
IEC;
EN;
machinery safety requirements;
pharmaceutical regulations;
validation requirements;
quality-management requirements.

When functionality may depend on such requirements:

identify the specific question;
separate general application functionality from regulatory requirements;
use specialized standards knowledge only when required;
clearly distinguish regulatory requirements from application design choices.

Do not introduce compliance functionality into unrelated features.

Do not claim compliance based solely on application functionality.

12. Data Model Principles

Project-management information should use structured data wherever practical.

Avoid storing information only as free text when it will later need to be:

filtered;
sorted;
reported;
assigned;
aggregated;
linked;
tracked;
calculated.

Entities should have stable unique identifiers.

Relationships between entities should be explicit.

Examples:

Project
→ Stage
→ Gate
→ Deliverable

Project
→ Action

Project
→ Risk

Project
→ Issue

Project
→ Budget Item

Project
→ Milestone

Project
→ Meeting

Project
→ Change

Avoid duplicating the same information across modules.

Where information is used in dashboards or reports, prefer deriving it from the underlying project data instead of asking users to enter the same information again.

13. Data Model Evolution

Do not attempt to design the complete final database schema at the beginning of development.

Add entities and relationships when required by actual functionality.

However, when adding data structures:

use stable identifiers;
avoid unnecessary duplication;
use clear relationships;
consider reasonable future extension;
avoid decisions that unnecessarily block obvious future requirements.

Do not add unused fields purely because they may be needed someday.

14. UI / UX Principles

This application is a professional engineering and project-management tool.

Prioritize:

clarity;
information density;
fast navigation;
minimal clicks;
fast data entry;
consistent layouts;
traceability;
clear project status;
useful filtering;
useful sorting.

Tables are appropriate for operational project data.

Dashboards should summarize existing information and allow navigation to the underlying data.

Avoid decorative UI that does not improve usability.

Avoid excessive animations.

Avoid unnecessary screen transitions.

Desktop usage is the primary use case unless requirements change.

Consistency is more important than visual novelty.

15. Component Reuse

Before creating a new UI component:

check whether an appropriate existing component already exists;
reuse established application patterns where possible.

Reusable components are encouraged when there is genuine reuse.

Do not create generic abstractions for components that currently have only one simple use case unless there is a clear benefit.

Avoid both:

unnecessary duplication;
premature abstraction.

16. Change Control

Do not silently change existing behaviour.

If requested functionality requires a significant:

architectural change;
database migration;
dependency change;
breaking UI change;
change to existing project data;
authentication change;
deployment change;

explain this during planning before implementation.

If implementation reveals such a change unexpectedly, stop and return to planning.

17. Dependencies

Do not add third-party dependencies without a clear benefit.

Before adding a dependency, consider whether:

existing functionality already solves the problem;
the framework already provides the capability;
a simple implementation is sufficient.

If a significant new dependency is proposed, mention it during planning.

Avoid dependencies for trivial functionality.

18. Verification Principle

Verification must remain proportional to the scope and risk of the change.

For normal incremental development, use the following verification order:

Run relevant lint/type checks.
Run the production build when appropriate.
Perform targeted functional verification only when it provides meaningful additional confidence.

Do not spend substantial time or context establishing new testing infrastructure merely to verify a small development increment.

Browser-based verification is useful when browser tooling is already available and operational.

If browser verification requires:

installing browsers;
installing system packages;
configuring new infrastructure;
obtaining elevated permissions;
significant troubleshooting;

stop and report that browser verification is currently unavailable.

Do not install new global tools, browsers, system packages, testing frameworks, or other verification infrastructure without user approval.

Do not create complex alternative verification methods solely to compensate for unavailable browser automation unless the functionality is sufficiently high-risk to justify it.

For a normal low-risk increment, successful lint, type checking, build verification, and targeted code/data verification are sufficient unless otherwise requested.

19. Error Handling

User-facing errors should be understandable and actionable.

Avoid exposing unnecessary technical details to the user.

Development errors should provide enough information to diagnose the problem.

Do not add elaborate error-handling infrastructure before it is required.

20. Deployment Philosophy

The application is intended to ultimately operate as a centrally hosted web application accessible through a standard browser.

However, early development may run locally.

Do not introduce complex deployment infrastructure before required.

The architecture should not assume that the application will permanently run only on one local computer.

Avoid unnecessary dependence on a specific cloud provider unless a deployment decision has explicitly been made.

Decisions regarding:

hosting;
cloud provider;
production database;
authentication provider;
backups;
domains;
CI/CD;
enterprise infrastructure;

should be made incrementally when those capabilities become necessary.

21. Multi-User Awareness

The application may eventually be used by multiple project participants.

Examples include:

Project Managers;
engineers;
project sponsors;
quality/validation personnel;
stakeholders.

Current functionality does not need to implement authentication, permissions, or multi-user workflows unless explicitly requested.

However, avoid architectural decisions that unnecessarily assume that all data will permanently belong to one single local user.

Concepts such as ownership and responsibility should be represented in the data model when they are functionally required.

22. Dashboard and Reporting Principle

Dashboards and reports should primarily be outputs of existing structured project data.

Avoid requiring duplicate manual entry solely for reporting.

For example:

An overdue action should be derived from:

status + due date

rather than requiring a separate manually entered "overdue" status.

Likewise, dashboards should preferably calculate or summarize information from the underlying project entities.

Do not build dashboard calculations before the required underlying data exists.

23. Documentation Principle

Keep documentation useful and proportionate.

Update documentation when:

architecture changes materially;
important development conventions are introduced;
new setup steps are required;
behaviour would otherwise be difficult for future development sessions to understand.

Do not create documentation for every minor code change.

Code should remain understandable without excessive documentation.

24. Avoid Silent Assumptions

If a requirement is ambiguous but the decision is minor and easily reversible, choose the simplest reasonable interpretation and state the assumption.

If ambiguity could materially affect:

architecture;
data structure;
user workflow;
existing data;
security;
significant development effort;

ask for clarification during planning.

Do not invent business requirements.

25. Preserve User Control

The user remains responsible for product and business decisions.

When multiple meaningful approaches exist:

explain the alternatives concisely;
explain relevant trade-offs;
recommend a technically sensible default when appropriate;
allow the user to decide before implementation.

Do not make significant product decisions silently.

26. Definition of Done

A development increment is complete when:

the approved functionality has been implemented;
implementation remains within the approved scope;
relevant verification has been completed;
no known critical regression has been introduced;
the result has been summarized concisely;
significant limitations are identified;
the application remains in a usable state.

Completion of one increment does NOT authorize implementation of the next increment.

Wait for the next user request.

27. Guiding Rule

When uncertain, prefer:

Understand first.
Plan before building.
Ask before making significant decisions.
Build the smallest useful increment.
Reuse before creating.
Keep the architecture simple.
Verify actual behaviour.
Do not implement tomorrow's requirements today.