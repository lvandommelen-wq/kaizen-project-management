-- Gate reopening is the only supported backward lifecycle transition.
-- One Gate per Project or Package scope may await renewed formal approval.

ALTER TABLE gate
  ADD COLUMN reapproval_required boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX gate_one_project_reapproval_required_idx
  ON gate(project_id)
  WHERE package_id IS NULL AND reapproval_required;

CREATE UNIQUE INDEX gate_one_package_reapproval_required_idx
  ON gate(package_id)
  WHERE package_id IS NOT NULL AND reapproval_required;
