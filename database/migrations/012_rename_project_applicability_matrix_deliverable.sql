-- Rename only records that still use the previous default title. A Project
-- Manager's customized title is intentionally left unchanged.
UPDATE deliverable
SET title = 'Project Stage-Gate Deliverable Applicability Matrix',
    template_version = greatest(coalesce(template_version, 0), 4),
    updated_at = now()
WHERE template_id = 'project_stage_gate_applicability_matrix'
  AND package_id IS NULL
  AND scope_level = 'project'
  AND title = 'Project Stage-Gate Applicability Matrix';
