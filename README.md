This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Identity Foundation

Authentication uses Better Auth, a single-tenant Microsoft Entra workforce application, and PostgreSQL. Operational data uses the ignored `.data` directory by default; an explicitly selected PostgreSQL test mode is also available after migration and import.

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
OPERATIONAL_DATA_BACKEND=json
```

These values are server-side. Never prefix them with `NEXT_PUBLIC_`, print them in logs, or commit `.env.local`.

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

Operational persistence defaults to `.data/*.json`. Migration and import commands do not switch the runtime backend automatically.

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

For isolated runtime verification against a migrated and imported database, set:

```dotenv
OPERATIONAL_DATA_BACKEND=postgres
```

Only the exact values `json` and `postgres` are accepted. PostgreSQL mode fails closed when migration `006_runtime_persistence_safety.sql` is absent; it never falls back to JSON or performs dual writes. Public Gate Review responses remain disabled in PostgreSQL mode until authenticated Approver assignment and project-level authorization are integrated. This switch is for explicit verification and is not a production activation procedure.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
