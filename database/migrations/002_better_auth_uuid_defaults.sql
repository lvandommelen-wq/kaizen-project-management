ALTER TABLE app_user
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE auth_session
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE user_identity
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();

ALTER TABLE auth_verification
  ALTER COLUMN id SET DEFAULT pg_catalog.gen_random_uuid();
