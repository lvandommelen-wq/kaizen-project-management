import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CurrentUser } from "./current-user";

export type AuditEventInput = {
  eventType: string;
  resourceType: string;
  resourceId: string;
  changeSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export async function insertAuditEvent(
  client: PoolClient,
  actor: CurrentUser,
  projectId: string | null,
  event: AuditEventInput,
) {
  await client.query(
    `INSERT INTO audit_event (
       request_id, actor_user_id, actor_provider_tenant_id,
       actor_provider_object_id, actor_access_class, project_id, event_type,
       resource_type, resource_id, change_summary, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
    [
      randomUUID(),
      actor.id,
      actor.providerTenantId,
      actor.providerObjectId,
      actor.accessClass,
      projectId,
      event.eventType,
      event.resourceType,
      event.resourceId,
      JSON.stringify(event.changeSummary ?? {}),
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}
