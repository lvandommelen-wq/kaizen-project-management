-- Access Management foundation. Project ownership remains authoritative in
-- project_membership; all collaborator access is represented by explicit,
-- revocable scope grants and positive module permissions.

ALTER TABLE app_user
  DROP CONSTRAINT app_user_access_class_check,
  ADD CONSTRAINT app_user_access_class_check CHECK (
    access_class IN ('internal', 'external_reviewer', 'external_collaborator')
  );

ALTER TABLE audit_event
  DROP CONSTRAINT audit_event_actor_access_class_check,
  ADD CONSTRAINT audit_event_actor_access_class_check CHECK (
    actor_access_class IS NULL
    OR actor_access_class IN ('internal', 'external_reviewer', 'external_collaborator')
  );

CREATE TABLE access_grant (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (
    scope_type IN ('entire_project', 'overall_project', 'specific_package')
  ),
  package_id text,
  authority_role text NOT NULL DEFAULT 'collaborator' CHECK (
    authority_role IN ('collaborator', 'project_access_manager', 'package_lead')
  ),
  origin text NOT NULL DEFAULT 'manual' CHECK (
    origin IN ('manual', 'legacy_membership', 'access_request')
  ),
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id),
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id)
    ON DELETE RESTRICT,
  CHECK (
    (scope_type = 'specific_package' AND package_id IS NOT NULL)
    OR (scope_type IN ('entire_project', 'overall_project') AND package_id IS NULL)
  ),
  CHECK (
    (authority_role = 'package_lead' AND scope_type = 'specific_package')
    OR (authority_role = 'project_access_manager' AND scope_type = 'entire_project')
    OR authority_role = 'collaborator'
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX access_grant_active_scope_idx
  ON access_grant(project_id, user_id, scope_type, coalesce(package_id, ''))
  WHERE revoked_at IS NULL;
CREATE INDEX access_grant_user_project_idx
  ON access_grant(user_id, project_id)
  WHERE revoked_at IS NULL;
CREATE INDEX access_grant_package_idx
  ON access_grant(package_id, user_id)
  WHERE package_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE access_grant_permission (
  grant_id uuid NOT NULL REFERENCES access_grant(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN (
    'overview', 'actions', 'risks', 'issues', 'decisions', 'changes_moc',
    'budget', 'planning', 'deliverables', 'gate_reviews', 'documents'
  )),
  permission text NOT NULL CHECK (permission IN ('read', 'read_write')),
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grant_id, module)
);

CREATE INDEX access_grant_permission_module_idx
  ON access_grant_permission(module, permission, grant_id);

CREATE TABLE access_request (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  collaborator_type text NOT NULL CHECK (
    collaborator_type IN ('internal', 'external')
  ),
  scope_type text NOT NULL CHECK (
    scope_type IN ('entire_project', 'overall_project', 'specific_package')
  ),
  package_id text,
  name text NOT NULL CHECK (btrim(name) <> ''),
  email text NOT NULL CHECK (btrim(email) <> ''),
  normalized_email text NOT NULL CHECK (
    normalized_email = lower(btrim(normalized_email)) AND btrim(normalized_email) <> ''
  ),
  organization_name text NOT NULL DEFAULT '',
  requested_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'cancelled', 'activated')
  ),
  decided_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  decision_comment text NOT NULL DEFAULT '',
  identity_link_status text NOT NULL DEFAULT 'not_started' CHECK (
    identity_link_status IN ('not_started', 'awaiting_authentication', 'linked')
  ),
  linked_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  activated_grant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, project_id),
  FOREIGN KEY (package_id, project_id)
    REFERENCES project_package(id, project_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (activated_grant_id, project_id)
    REFERENCES access_grant(id, project_id)
    ON DELETE RESTRICT,
  CHECK (
    (scope_type = 'specific_package' AND package_id IS NOT NULL)
    OR (scope_type IN ('entire_project', 'overall_project') AND package_id IS NULL)
  ),
  CHECK (
    (status IN ('pending', 'cancelled')
      AND decided_by_user_id IS NULL AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected', 'activated')
      AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK (
    (identity_link_status = 'linked' AND linked_user_id IS NOT NULL)
    OR (identity_link_status <> 'linked' AND linked_user_id IS NULL)
  ),
  CHECK (
    (status = 'activated' AND identity_link_status = 'linked'
      AND activated_grant_id IS NOT NULL)
    OR (status <> 'activated' AND activated_grant_id IS NULL)
  )
);

CREATE INDEX access_request_project_status_idx
  ON access_request(project_id, status, requested_at DESC, id);
CREATE INDEX access_request_package_status_idx
  ON access_request(package_id, status, requested_at DESC, id)
  WHERE package_id IS NOT NULL;
CREATE INDEX access_request_normalized_email_idx
  ON access_request(normalized_email, status);

CREATE TABLE access_request_permission (
  request_id uuid NOT NULL REFERENCES access_request(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN (
    'overview', 'actions', 'risks', 'issues', 'decisions', 'changes_moc',
    'budget', 'planning', 'deliverables', 'gate_reviews', 'documents'
  )),
  permission text NOT NULL CHECK (permission IN ('read', 'read_write')),
  PRIMARY KEY (request_id, module)
);

CREATE FUNCTION enforce_access_grant_identity()
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
      AND app_user.access_class IN ('internal', 'external_collaborator')
  ) THEN
    RAISE EXCEPTION 'An access grant requires an active verified application collaborator.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER access_grant_identity_guard
BEFORE INSERT OR UPDATE OF user_id ON access_grant
FOR EACH ROW EXECUTE FUNCTION enforce_access_grant_identity();

-- Existing editor/viewer access is retained for the first integrated module
-- without altering the legacy membership rows or granting future modules.
INSERT INTO access_grant (
  project_id, user_id, scope_type, package_id, authority_role, origin,
  created_by_user_id, updated_by_user_id, created_at, updated_at
)
SELECT membership.project_id, membership.user_id, 'entire_project', NULL,
  'collaborator', 'legacy_membership', owner.user_id, owner.user_id,
  membership.created_at, membership.updated_at
FROM project_membership AS membership
JOIN LATERAL (
  SELECT owner_membership.user_id
  FROM project_membership AS owner_membership
  JOIN app_user AS owner_user ON owner_user.id = owner_membership.user_id
  WHERE owner_membership.project_id = membership.project_id
    AND owner_membership.role = 'owner'
    AND owner_user.status = 'active'
    AND owner_user.access_class = 'internal'
  ORDER BY owner_membership.user_id
  LIMIT 1
) AS owner ON true
WHERE membership.role IN ('editor', 'viewer');

INSERT INTO access_grant_permission (
  grant_id, module, permission, created_by_user_id, updated_by_user_id,
  created_at, updated_at
)
SELECT grant_record.id, 'actions',
  CASE membership.role WHEN 'editor' THEN 'read_write' ELSE 'read' END,
  grant_record.created_by_user_id, grant_record.updated_by_user_id,
  grant_record.created_at, grant_record.updated_at
FROM access_grant AS grant_record
JOIN project_membership AS membership
  ON membership.project_id = grant_record.project_id
 AND membership.user_id = grant_record.user_id
WHERE grant_record.origin = 'legacy_membership'
  AND membership.role IN ('editor', 'viewer');

COMMENT ON TABLE access_grant IS
  'Explicit revocable collaborator scope assignments. Protected Project ownership remains in project_membership.';
COMMENT ON TABLE access_grant_permission IS
  'Positive module permissions for one access grant. No row means No Access.';
COMMENT ON TABLE access_request IS
  'Internal or external access proposals. Approval never activates access until verified identity linking creates a grant.';
COMMENT ON TABLE access_request_permission IS
  'Structured module permissions requested by an access proposal.';
