CREATE TABLE organization (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  normalized_email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  organization_id text REFERENCES organization(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  access_class text NOT NULL DEFAULT 'external_reviewer' CHECK (access_class IN ('internal', 'external_reviewer')),
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_session (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_session_user_id_idx ON auth_session(user_id);

CREATE TABLE user_identity (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_object_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  provider_tenant_id text NOT NULL,
  provider_subject text NOT NULL,
  provider_email_snapshot text,
  entra_account_type integer NOT NULL CHECK (entra_account_type IN (0, 1)),
  last_authenticated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_object_id),
  UNIQUE (provider, provider_tenant_id, provider_object_id)
);

CREATE INDEX user_identity_user_id_idx ON user_identity(user_id);

CREATE TABLE auth_verification (
  id uuid PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);
