-- Explicit Project creation capability and complete implemented Package access.
-- Existing Project, Package, Gate and historical evidence records are untouched.

CREATE TABLE project_creation_authorization (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE RESTRICT,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  authorized_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);

CREATE INDEX project_creation_authorization_active_idx
  ON project_creation_authorization(user_id)
  WHERE revoked_at IS NULL;

CREATE FUNCTION enforce_project_creator_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app_user
    JOIN user_identity
      ON user_identity.user_id = app_user.id
     AND user_identity.provider = 'microsoft'
    WHERE app_user.id = NEW.user_id
      AND app_user.status = 'active'
      AND app_user.access_class = 'internal'
      AND app_user.last_authenticated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Project creation requires an active authenticated internal User.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_creation_authorization_identity_guard
BEFORE INSERT OR UPDATE OF user_id ON project_creation_authorization
FOR EACH ROW EXECUTE FUNCTION enforce_project_creator_identity();

-- Preserve the legitimate creation workflow without making Project ownership a
-- continuing source of global creation authority. Future Owners are not added
-- automatically.
INSERT INTO project_creation_authorization (
  user_id, authorized_at, authorized_by_user_id
)
SELECT membership.user_id, min(membership.created_at), NULL
FROM project_membership AS membership
JOIN app_user ON app_user.id = membership.user_id
JOIN user_identity
  ON user_identity.user_id = app_user.id
 AND user_identity.provider = 'microsoft'
WHERE membership.role = 'owner'
  AND app_user.status = 'active'
  AND app_user.access_class = 'internal'
  AND app_user.last_authenticated_at IS NOT NULL
GROUP BY membership.user_id
ON CONFLICT (user_id) DO NOTHING;

-- A Package Lead has a fixed Read & Write bundle for every Package module whose
-- routes, reads and mutations are enforced in this increment.
INSERT INTO access_grant_permission (
  grant_id, module, permission, created_by_user_id, updated_by_user_id,
  created_at, updated_at
)
SELECT grant_record.id, implemented_module.module, 'read_write',
  grant_record.created_by_user_id, grant_record.updated_by_user_id,
  grant_record.created_at, now()
FROM access_grant AS grant_record
CROSS JOIN (VALUES
  ('overview'),
  ('actions'),
  ('deliverables'),
  ('gate_reviews')
) AS implemented_module(module)
WHERE grant_record.authority_role = 'package_lead'
  AND grant_record.scope_type = 'specific_package'
  AND grant_record.package_id IS NOT NULL
  AND grant_record.revoked_at IS NULL
ON CONFLICT (grant_id, module) DO UPDATE
  SET permission = 'read_write',
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = EXCLUDED.updated_at;

-- Preserve legacy editor/viewer Package behavior through explicit permissions.
INSERT INTO access_grant_permission (
  grant_id, module, permission, created_by_user_id, updated_by_user_id,
  created_at, updated_at
)
SELECT grant_record.id, implemented_module.module,
  CASE membership.role WHEN 'editor' THEN 'read_write' ELSE 'read' END,
  grant_record.created_by_user_id, grant_record.updated_by_user_id,
  grant_record.created_at, now()
FROM access_grant AS grant_record
JOIN project_membership AS membership
  ON membership.project_id = grant_record.project_id
 AND membership.user_id = grant_record.user_id
CROSS JOIN (VALUES
  ('overview'),
  ('actions'),
  ('deliverables'),
  ('gate_reviews')
) AS implemented_module(module)
WHERE grant_record.origin = 'legacy_membership'
  AND grant_record.revoked_at IS NULL
  AND membership.role IN ('editor', 'viewer')
ON CONFLICT (grant_id, module) DO UPDATE
  SET permission = EXCLUDED.permission,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = EXCLUDED.updated_at;

COMMENT ON TABLE project_creation_authorization IS
  'Explicit revocable application-level authority to create Projects. Project roles do not imply this capability.';
