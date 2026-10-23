-- Enforce the Increment 19A Action scope invariant while retaining the
-- existing central Project Action Register and association table.

DO $$
DECLARE
  ambiguous_actions text;
BEGIN
  SELECT string_agg(scoped.action_id, ', ' ORDER BY scoped.action_id)
  INTO ambiguous_actions
  FROM (
    SELECT action_id
    FROM project_action_package
    GROUP BY action_id
    HAVING count(*) > 1
  ) AS scoped;

  IF ambiguous_actions IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 020 requires each Action to reference at most one Package. Ambiguous Actions: %',
      ambiguous_actions;
  END IF;

  SELECT string_agg(scoped.action_id, ', ' ORDER BY scoped.action_id)
  INTO ambiguous_actions
  FROM (
    SELECT action.id AS action_id
    FROM project_action AS action
    LEFT JOIN gate ON gate.id = action.gate_id AND gate.project_id = action.project_id
    LEFT JOIN project_action_package AS link ON link.action_id = action.id
    WHERE action.source = 'gate'
    GROUP BY action.id, action.gate_id, gate.id, gate.package_id
    HAVING action.gate_id IS NULL
       OR gate.id IS NULL
       OR (gate.package_id IS NULL AND count(link.package_id) <> 0)
       OR (gate.package_id IS NOT NULL AND (
         count(link.package_id) <> 1
         OR count(link.package_id) FILTER (WHERE link.package_id = gate.package_id) <> 1
       ))
  ) AS scoped;

  IF ambiguous_actions IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 020 found Gate Actions whose Package scope does not match their Gate: %',
      ambiguous_actions;
  END IF;
END;
$$;

CREATE UNIQUE INDEX project_action_package_single_scope_idx
  ON project_action_package(action_id);

CREATE FUNCTION assert_gate_action_package_scope(target_action_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  action_record record;
  gate_package_id text;
  linked_package_id text;
  package_count integer;
BEGIN
  SELECT action.id, action.project_id, action.source, action.gate_id
  INTO action_record
  FROM project_action AS action
  WHERE action.id = target_action_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::integer, min(link.package_id)
  INTO package_count, linked_package_id
  FROM project_action_package AS link
  WHERE link.action_id = target_action_id;

  IF package_count > 1 THEN
    RAISE EXCEPTION 'An Action may reference at most one Package.';
  END IF;

  IF action_record.source <> 'gate' THEN
    RETURN;
  END IF;

  IF action_record.gate_id IS NULL THEN
    RAISE EXCEPTION 'A Gate Action must reference a Gate.';
  END IF;

  SELECT gate.package_id
  INTO gate_package_id
  FROM gate
  WHERE gate.id = action_record.gate_id
    AND gate.project_id = action_record.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A Gate Action must reference a Gate in its Project.';
  END IF;

  IF gate_package_id IS NULL AND package_count <> 0 THEN
    RAISE EXCEPTION 'A Project Gate Action must remain Overall Project scoped.';
  END IF;

  IF gate_package_id IS NOT NULL
    AND (package_count <> 1 OR linked_package_id IS DISTINCT FROM gate_package_id)
  THEN
    RAISE EXCEPTION 'A Package Gate Action must remain scoped to its own Package.';
  END IF;

  RETURN;
END;
$$;

CREATE FUNCTION enforce_gate_action_package_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'project_action' THEN
    PERFORM assert_gate_action_package_scope(NEW.id);
    IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
      PERFORM assert_gate_action_package_scope(OLD.id);
    END IF;
  ELSE
    IF TG_OP <> 'DELETE' THEN
      PERFORM assert_gate_action_package_scope(NEW.action_id);
    END IF;
    IF TG_OP <> 'INSERT'
      AND (TG_OP = 'DELETE' OR OLD.action_id IS DISTINCT FROM NEW.action_id)
    THEN
      PERFORM assert_gate_action_package_scope(OLD.action_id);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION enforce_gate_action_scope_after_gate_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  action_id text;
BEGIN
  FOR action_id IN
    SELECT project_action.id
    FROM project_action
    WHERE project_action.gate_id = NEW.id
  LOOP
    PERFORM assert_gate_action_package_scope(action_id);
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER project_action_gate_scope_guard
AFTER INSERT OR UPDATE ON project_action
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_gate_action_package_scope();

CREATE CONSTRAINT TRIGGER project_action_package_gate_scope_guard
AFTER INSERT OR UPDATE OR DELETE ON project_action_package
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_gate_action_package_scope();

CREATE CONSTRAINT TRIGGER gate_action_scope_guard
AFTER UPDATE OF project_id, package_id ON gate
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_gate_action_scope_after_gate_change();

COMMENT ON INDEX project_action_package_single_scope_idx IS
  'An Action is Overall Project scoped when no row exists and Specific Package scoped when exactly one row exists.';
