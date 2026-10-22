# Owner-only pilot runbook

This runbook prepares a restricted cloud pilot. It does not authorize spending, provisioning, repository transfer, Entra changes, data writes, DNS changes, email, or wider access. Obtain the relevant approval before each provider-side action.

## Fixed pilot boundary

- Production host: `https://operations.kaizenpm.be`
- Vercel runtime: Node.js 24 in Frankfurt (`fra1`)
- Runtime database: pooled Neon PostgreSQL URL with required TLS
- Administrative database work: direct Neon PostgreSQL URL used only from the operator workstation
- Authentication: separate production Microsoft Entra app registration in the approved tenant
- Admission: exact `PILOT_OWNER_TENANT_ID` plus `PILOT_OWNER_OBJECT_ID`
- Persistence: `OPERATIONAL_DATA_BACKEND=postgres`
- External Gate Reviews and all email delivery: disabled
- Production access: one imported active internal Owner and its Microsoft identity; no automatic User creation

The private company GitHub repository, Vercel team/project, Neon project, Entra registration, DNS record, and backup location must have named company ownership. Record those owners in the change ticket without recording credentials.

## Phase A approval gates and cost controls

Obtain separate written approval immediately before each provider-side action. The approval record must contain the provider's current checkout price, taxes/currency, billing owner, cancellation path, spend alert/limit, and expected monthly pilot maximum; do not rely on an earlier planning estimate.

| Gate | Approval trigger | Required control before approval |
| --- | --- | --- |
| Private GitHub destination | Create/transfer repository or change visibility | Company owner, private visibility, protected `main`, required CI, no secret history |
| Vercel Pro | Create/upgrade team or attach billable project | Frankfurt region, Node.js 24, Standard Protection with Vercel Authentication, spend alerts/limit, named billing owner |
| Neon Launch | Create paid project/branch or increase compute/storage | Frankfurt region, scale-to-zero, pooled runtime role, separate admin role, spend alerts/limit, retention confirmed |
| Production Entra app | Create registration, secret, redirect, assignment | Single tenant, Owner-only assignment, secret expiry owner, recovery administrators |
| SharePoint backup location | Store the first encrypted backup | Suitability, retention, access review, recovery access, file-size support, separate key custody |
| Production DNS | Add or change `operations.kaizenpm.be` | Exact Vercel target copied at execution time, rollback value recorded, successful pre-DNS checks |

Stop if a provider cannot enforce or clearly report the approved pilot spending boundary. Creating a free resource still requires ownership and deletion-path approval, but not paid-plan approval unless it can incur usage charges.

Price snapshot checked on 2026-10-22: Vercel Pro lists `$20 USD/month` for one developer seat, excluding tax, with usage billed beyond included credit; configure a hard spend limit rather than accepting the default on-demand budget. Vercel Password Protection is a separate `$20 USD/project/month` add-on and is not required because Standard Protection with Vercel Authentication is available without that add-on. Neon Launch has no monthly minimum and lists compute at `$0.106/CU-hour`, storage at `$0.35/GB-month`, instant restore at `$0.20/GB-month`, and snapshots at `$0.09/GB-month`; scale-to-zero avoids compute charges while suspended. GitHub lists private repositories on Free at `$0`, but Team is `$4 USD/user/month` if private-repository rules required by company policy are unavailable on the company account. Prices exclude applicable tax and must be rechecked at approval.

## Environment inventory

Configure these as server-side Vercel Production variables. Values must never be committed, printed, placed in `NEXT_PUBLIC_*`, or copied into this runbook.

| Variable | Production requirement |
| --- | --- |
| `OPERATIONAL_DATA_BACKEND` | Exact value `postgres` |
| `OWNER_ONLY_PILOT` | Exact value `true` |
| `PILOT_OWNER_TENANT_ID` | Approved production tenant UUID |
| `PILOT_OWNER_OBJECT_ID` | Approved Owner object UUID |
| `BETTER_AUTH_SECRET` | Independent production secret of at least 32 characters |
| `BETTER_AUTH_URL` | Exact credential-free HTTPS production origin |
| `APP_BASE_URL` | Same exact production origin |
| `MICROSOFT_CLIENT_ID` | Production Entra application/client UUID |
| `MICROSOFT_CLIENT_SECRET` | Production Entra client secret |
| `MICROSOFT_TENANT_ID` | Same UUID as `PILOT_OWNER_TENANT_ID` |
| `DATABASE_URL` | Neon pooled endpoint with `sslmode=require` or `sslmode=verify-full` |

Do not configure `DATABASE_DIRECT_URL`, `OPERATIONAL_DATABASE_URL`, `RESEND_API_KEY`, or `EMAIL_FROM` in Vercel. Do not configure database URLs or secrets under a `NEXT_PUBLIC_*` name. Keep Preview isolated from Production: use the existing approved staging Entra registration, a non-production database, and Vercel Deployment Protection.

## Preflight

1. Confirm the approved commit and a clean worktree: `git status --short` and `git rev-parse HEAD`.
2. Confirm CI passed lint, TypeScript, unit tests, and the production build for that exact commit.
3. Confirm the destination repository is private and branch protection requires the verification workflow.
4. Confirm the Neon region is Frankfurt, scale-to-zero is enabled, and the approved spend limits/alerts are recorded.
5. Confirm the Vercel project uses Node.js 24, Frankfurt, Deployment Protection for Preview, and the approved spend limits/alerts.
6. Confirm the production Entra registration is single-tenant, assigned only to the Owner, and has this Web redirect URI: `https://operations.kaizenpm.be/api/auth/callback/microsoft`.
7. Confirm the approved Owner tenant/object IDs against Entra. Never validate admission by email.
8. Confirm `operations.kaizenpm.be` is still unused. Do not change DNS yet.

## Prepare the Owner transfer

Run from the approved source workstation. The export contains identity PII but excludes sessions, verifications, password, access token, refresh token, and ID token fields. It must remain in the ignored `.migration-reports/` directory with restrictive permissions.

```bash
umask 077
export IDENTITY_SOURCE_DATABASE_URL='<approved-source-direct-url>'
export PILOT_OWNER_TENANT_ID='<approved-tenant-uuid>'
export PILOT_OWNER_OBJECT_ID='<approved-object-uuid>'
npm run db:identity:export -- --output .migration-reports/owner-pilot/owner-identity.json
```

Record the reported fingerprint. Inspect only field names and counts; do not paste PII or the file contents into tickets or logs. Build the ignored Owner map using the transferred application User UUID and the existing Project UUID:

```json
{
  "owners": [
    { "projectId": "<project-uuid>", "userId": "<application-user-uuid>" }
  ]
}
```

## Database cutover order

The target must be a new, empty database. These commands are examples for the approved operator; setting the variables or running a write command requires the separate cutover approval.

1. Set the direct administrative URL only in the operator shell: `export DATABASE_DIRECT_URL='<target-direct-url>'`.
2. Check migration state: `npm run db:migrate:status`.
3. Apply migrations `001` through `007`: `npm run db:migrate`.
4. Validate the identity file without connecting: `npm run db:identity:import -- --input .migration-reports/owner-pilot/owner-identity.json`.
5. Import the Owner transactionally: `npm run db:identity:import -- --input .migration-reports/owner-pilot/owner-identity.json --apply`.
6. Set the operational target only in the operator shell: `export OPERATIONAL_DATABASE_URL='<target-direct-url>'` and `export OPERATIONAL_EXPECTED_DATABASE='<exact-database-name>'`.
7. Dry-run the operational source: `npm run db:operational -- --dry-run --allow-runtime-projection --owner-map .migration-reports/owner-pilot/owners.json`.
8. Compare source counts, protected-data hashes, logical fingerprint, historical-evidence fingerprint, Owner UUID, and Project UUID with the approved baseline.
9. Import once: `npm run db:operational -- --import --allow-runtime-projection --owner-map .migration-reports/owner-pilot/owners.json`.
10. Validate independently: `npm run db:operational -- --validate --allow-runtime-projection --owner-map .migration-reports/owner-pilot/owners.json`.
11. Remove the direct/admin variables from the shell after evidence is captured: `unset DATABASE_DIRECT_URL OPERATIONAL_DATABASE_URL IDENTITY_SOURCE_DATABASE_URL`.

Stop on any mismatch. Do not fix production rows manually or rerun an uncertain write.

## Deployment order

1. Add only the approved Production variables from the inventory to Vercel.
2. Verify no email or direct/admin database variable exists in Production or Preview.
3. Deploy the exact commit to protected staging with its isolated database and existing approved staging Entra registration. Test sign-in, Project visibility, membership enforcement, reads, one reversible write, audit attribution, sign-out, and sign-in again.
4. In protected staging, test an unapproved tenant member. Authentication must not create an `app_user`, `user_identity`, or session row. Test `/reviews/<id>` as the Owner and any existing external account; both must be blocked during pilot mode.
5. Deploy the same exact commit to Production without attaching the production domain. Inspect build output for the expected production-policy pass and absence of credentials. Do not attempt Microsoft sign-in through the generated Vercel hostname because it is not an approved Entra redirect origin.
6. Add the custom domain in Vercel and copy the exact DNS target supplied for that project.
7. Add the exact Vercel-provided DNS record at Combell. Do not improvise a target value.
8. Verify HTTPS and the production Entra redirect on `operations.kaizenpm.be`.
9. Test the approved Owner: sign-in, Project visibility, membership enforcement, reads, one reversible write, audit attribution, sign-out, and sign-in again.
10. Test an unapproved tenant member. Authentication must not create an `app_user`, `user_identity`, or session row.
11. Test `/reviews/<id>` as the Owner and any existing external account. Both must be blocked during pilot mode.
12. Confirm identity counts remain one User, one Microsoft identity, zero verifications, and only expected active sessions.
13. Record sanitized evidence and begin the approved monitoring window.

## Rollback and shutdown

- Application regression without incompatible data changes: promote the last verified immutable Vercel deployment, then repeat the smoke checks.
- Initial deployment failure: do not change DNS, or remove the new DNS record if it was already added. Keep the local system authoritative.
- Authorization or identity failure: remove the Owner assignment or disable the Entra enterprise application, revoke active sessions, and keep the deployment inaccessible while investigating.
- Suspected secret exposure: rotate the affected Entra secret, Better Auth secret, and/or Neon role credential; update Vercel server-side variables; redeploy; revoke sessions. Do not paste the old or new value into evidence.
- Database issue: stop application writes before restore. Never reverse schema migrations manually and never restore over the only copy.

The initial pilot has no safe application rollback target until one verified production deployment exists. DNS rollback does not reverse database writes.

## Backup and recovery rehearsal

Before first production access and before every migration, create an approved Neon restore point/branch when available and a logical PostgreSQL dump from the direct endpoint:

```bash
umask 077
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_DIRECT_URL" --file=.migration-reports/owner-pilot/kaizen-production.dump
openssl enc -aes-256-cbc -salt -pbkdf2 -in .migration-reports/owner-pilot/kaizen-production.dump -out .migration-reports/owner-pilot/kaizen-production.dump.enc
```

The encryption command prompts for a passphrase. Store the passphrase separately from the encrypted dump. Verify SharePoint retention, access control, file-size support, restore accessibility, and organizational suitability before using it as the backup repository. Upload only the encrypted file and a sanitized manifest containing date, commit, schema migration names, ciphertext checksum, database name, and operator. Delete plaintext dumps from the workstation after verification.

Rehearse restore only in a separately approved empty recovery database:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -in kaizen-production.dump.enc -out .migration-reports/owner-pilot/recovery.dump
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RECOVERY_DATABASE_DIRECT_URL" .migration-reports/owner-pilot/recovery.dump
```

Then check `npm run db:migrate:status` against the recovery URL, run operational validation against the unchanged approved source, verify the Owner identity and project membership by stable IDs, and perform the smoke test through an isolated recovery deployment. Record recovery point, recovery time, fingerprints, and any gap. Destroy the recovery resources only after evidence approval.

## Incident evidence

Capture UTC time, deployment ID, commit, sanitized configuration names, migration status, operational report fingerprints, affected stable IDs, and append-only audit-event IDs. Never capture cookies, tokens, database URLs, secrets, or raw identity-transfer contents. Preserve evidence before cleanup where safe.
