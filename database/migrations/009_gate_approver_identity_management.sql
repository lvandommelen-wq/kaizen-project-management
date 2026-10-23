ALTER TABLE gate_approver
  ADD COLUMN organization_name text,
  ADD CONSTRAINT gate_approver_organization_name_check CHECK (
    organization_name IS NULL OR btrim(organization_name) <> ''
  );

WITH verified_matches AS (
  SELECT approver.id AS gate_approver_id,
         identity.user_id
  FROM gate_approver AS approver
  JOIN user_identity AS identity
    ON identity.provider = 'microsoft'
   AND identity.provider_tenant_id = approver.expected_provider_tenant_id
   AND identity.provider_object_id = approver.expected_provider_object_id
  JOIN app_user
    ON app_user.id = identity.user_id
   AND app_user.status = 'active'
  WHERE approver.assigned_user_id IS NULL
    AND approver.expected_provider_tenant_id IS NOT NULL
    AND approver.expected_provider_object_id IS NOT NULL
), reconciled AS (
  UPDATE gate_approver AS approver
  SET assigned_user_id = verified_matches.user_id
  FROM verified_matches
  WHERE approver.id = verified_matches.gate_approver_id
  RETURNING approver.id, approver.gate_id, approver.assigned_user_id
)
INSERT INTO audit_event (
  request_id,
  project_id,
  event_type,
  resource_type,
  resource_id,
  change_summary,
  metadata
)
SELECT pg_catalog.gen_random_uuid(),
       gate.project_id,
       'gate_approver.identity_reconciled',
       'gate_approver',
       reconciled.id,
       jsonb_build_object('assignedUserId', reconciled.assigned_user_id),
       jsonb_build_object(
         'gateId', reconciled.gate_id,
         'packageId', gate.package_id,
         'source', 'migration_009_exact_verified_identity_match'
       )
FROM reconciled
JOIN gate ON gate.id = reconciled.gate_id;

UPDATE gate_approver AS approver
SET organization_name = organization.name
FROM app_user
JOIN organization ON organization.id = app_user.organization_id
WHERE approver.assigned_user_id = app_user.id
  AND approver.organization_name IS NULL;
