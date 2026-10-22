UPDATE user_identity
SET id_token = NULL
WHERE id_token IS NOT NULL;
