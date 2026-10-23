This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Local development uses PostgreSQL for identity and operational data. Ensure the
configured local PostgreSQL server is running, check the migration state, and
then start the development server:

```bash
npm run db:migrate:status
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The ignored `.env.local` must select `OPERATIONAL_DATA_BACKEND=postgres`. The
local `DATABASE_URL` may use `sslmode=disable` only for a loopback PostgreSQL
server. If PostgreSQL is unavailable, the application fails closed; do not
switch to the retained `.data` JSON files as a runtime fallback. Apply pending
migrations with `npm run db:migrate` before restarting the application.

## Gate Review Email

Gate Review invitations are sent from server actions through the Resend HTTP API. Configure these values in an ignored `.env.local` file:

```dotenv
RESEND_API_KEY=re_your_key
EMAIL_FROM=Kaizen Project Management <notifications@your-verified-domain.example>
APP_BASE_URL=http://localhost:3000
GATE_REVIEW_OTP_SECRET=replace-with-a-separate-random-value-of-at-least-32-characters
```

`EMAIL_FROM` must contain a valid sender accepted by your Resend account, normally on a verified domain. `APP_BASE_URL` must be a credential-free absolute HTTP(S) URL and is used to create assignment-specific Gate Review links. Generate `GATE_REVIEW_OTP_SECRET` independently from `BETTER_AUTH_SECRET`; it is used only to create keyed OTP digests. Never prefix these variables with `NEXT_PUBLIC_` or commit their values.

To test delivery, submit a prepared Project or Package Gate with an Approver email address you control. Review History records each delivery attempt, its sanitized failure details, and the provider message ID when Resend accepts the send request. `Sent` means submission to Resend succeeded; it does not claim inbox delivery. An active failed invitation can be retried from Review History after configuration is corrected. Refreshing or opening a Gate page does not send email.

## Identity Foundation

Authentication uses Better Auth, a single-tenant Microsoft Entra workforce application, and PostgreSQL. PostgreSQL is also the active operational backend. The ignored `.data` directory is retained as migration source and recovery evidence, not as a runtime backend.

Create `.env.local` locally with restrictive permissions and edit it with your local editor. Do not send its contents through chat or commit it:

```bash
umask 077
touch .env.local
chmod 600 .env.local
openssl rand -base64 48
```

Use the generated value for `BETTER_AUTH_SECRET` and enter the Microsoft values copied from the Entra admin center:

```dotenv
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
DATABASE_URL=
OPERATIONAL_DATA_BACKEND=postgres

APP_BASE_URL=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM=
GATE_REVIEW_OTP_SECRET=
```

All of these values are server-side. Never prefix them with `NEXT_PUBLIC_`, print them in logs, or commit `.env.local`.

After creating an empty PostgreSQL database and setting `DATABASE_URL`, apply the database migrations:

```bash
npm run db:migrate
```

The development Entra App Registration must use the Web redirect URI:

```text
http://localhost:3000/api/auth/callback/microsoft
```

Configure the ID token optional claims `acct` and `email`. The application uses the Entra-issued `acct` claim only to establish the minimum access boundary: tenant members become `internal`, while guests and identities without the claim become `external_reviewer`. Authorization identity is always anchored to the tenant ID and object ID (`tid`, `oid`), never email or display name.

Microsoft ID tokens are validated during authentication and are not retained in PostgreSQL after their identity claims have been processed.

Operational routes under `/projects` require an active internal User. Authentication endpoints, `/sign-in`, and `/access-denied` remain outside that boundary. To test account disabling, identify the User by stable UUID and update its status in PostgreSQL; do not use email as the authorization key:

```sql
UPDATE app_user SET status = 'disabled', updated_at = now() WHERE id = '<application-user-uuid>';
```

## Operational PostgreSQL Foundation

Operational persistence uses PostgreSQL for local development. Migration and import commands do not switch the runtime backend automatically. The retained `.data/*.json` files are immutable migration and recovery inputs; they must not be used as a runtime fallback or written alongside PostgreSQL.

Check migration status and apply pending migrations with a direct PostgreSQL connection when available. The migration runner uses `DATABASE_DIRECT_URL` first and falls back to `DATABASE_URL`:

```bash
npm run db:migrate:status
npm run db:migrate
```

Inventory and validate the JSON source without writing to PostgreSQL:

```bash
npm run db:operational -- --dry-run --allow-runtime-projection --owner-map ./owners.json
```

The owner map must identify one existing active internal application User for every Project:

```json
{
  "owners": [
    { "projectId": "project-id", "userId": "application-user-uuid" }
  ]
}
```

For an isolated test import only, the owner requirement can be disabled with `--allow-missing-owner-map`. Do not use that option for a production cutover.

Import into an empty migrated database after setting a direct `OPERATIONAL_DATABASE_URL` and the exact database name in `OPERATIONAL_EXPECTED_DATABASE`. `OPERATIONAL_DATABASE_ROLE` is optional and can restrict the import session to an already-granted role:

```bash
npm run db:operational -- --import --allow-runtime-projection --owner-map ./owners.json
npm run db:operational -- --validate --allow-runtime-projection --owner-map ./owners.json
```

The importer rejects a database-name mismatch, a non-empty operational target, missing ownership, altered source data, and unapproved runtime normalization. Each run writes sanitized JSON and Markdown evidence to the ignored `.migration-reports/` directory.

For runtime access to the migrated and imported database, set:

```dotenv
OPERATIONAL_DATA_BACKEND=postgres
```

Only the exact values `json` and `postgres` are accepted by the backend policy, but this repository's active local workflow uses `postgres`. PostgreSQL mode fails closed when migration `007_project_authorization_audit.sql` is absent; it never falls back to JSON or performs dual writes. A production build fails unless `OPERATIONAL_DATA_BACKEND=postgres`, preventing accidental deployment with JSON operational persistence.

## Project authorization and Gate Reviews

In PostgreSQL mode, every Project requires at least one active internal Owner. The creator becomes the first Owner atomically. Owners manage membership and Project deletion, Editors manage operational data and Gate workflows, and Viewers have read-only access. Package authorization is inherited from the parent Project.

External Gate Approvers use Microsoft Entra B2B guest accounts. Invite and assign the guest to the enterprise application in Entra, then enter the guest's resource-tenant Object ID in the controlled Gate Approver configuration. The invitation email is delivery-only: `/reviews/<review-cycle-id>` requires authentication and an exact tenant ID plus object ID match against the frozen Approver assignment.

When `OWNER_ONLY_PILOT=true`, only the exact configured tenant/object identity is admitted, automatic User creation is disabled, and all external Gate Review routes and mutations are blocked. See [`docs/owner-pilot-runbook.md`](docs/owner-pilot-runbook.md) for the production configuration, manual identity transfer, deployment order, rollback, backup, and recovery controls.

PostgreSQL mutations create append-only audit events in the same transaction. Project members can inspect the latest events from the Project History page. Existing immutable Gate responses and invitation attempts remain the detailed governance evidence for those workflows.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

Cloud provisioning and production cutover are controlled manual operations. Follow the Owner-only pilot runbook; do not use an automatic deployment wizard or expose administrative database credentials to the application runtime.
