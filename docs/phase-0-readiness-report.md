# Increment 4B Phase 0 readiness report

Date: 2026-10-22

Result: **PASS for local deployment preparation; NOT AUTHORIZED for Phase A or production cutover.**

## Delivered

- Fail-closed Owner-only policy based on exact Entra tenant and object UUIDs.
- Automatic User creation disabled in pilot mode; unknown identities fail before account/session establishment.
- Pilot identity rechecked during account updates, session creation, and every current-user resolution.
- External Gate Review pages, proxy access, and server mutations blocked in pilot mode.
- Production build/runtime authentication validation for PostgreSQL-only persistence, HTTPS origins, tenant/client IDs, Owner IDs, pooled Neon TLS URL, secret length, absent email settings, absent public secrets, and absent Vercel admin database URLs.
- Vercel Node.js 24 and Frankfurt configuration without linking or deploying a project.
- Manual one-Owner identity export/import with exact schema, SHA-256 fingerprint, no credential/session/verification transfer, ignored output path, direct-target requirement, empty-target requirement, migration check, dry-run default, and transactional `--apply`.
- Credential-free GitHub Actions verification workflow.
- Deployment, rollback, backup, restore-rehearsal, incident, cost, and approval-gate runbook.
- Corrected migration prerequisite message from `004, 005, 006` to `004, 005, 007`.

## Verification

- ESLint: pass.
- TypeScript `npx tsc --noEmit`: pass.
- Operational unit tests: 21 pass, 1 PostgreSQL test skipped by the unit runner as designed.
- Guarded PostgreSQL integration: 1 pass using disposable test databases.
- Production-mode Next.js build: pass with sanitized CI-only values and email variables absent.
- Production fail-closed check: pass; the first local production build intentionally rejected email variables inherited from `.env.local` without exposing their values.
- Git whitespace/error check: pass.
- No cloud account, repository, Entra, DNS, email, migration, import, or production write occurred.

## Data safety

All protected source hashes remained identical to the Phase 0 baseline:

| File | SHA-256 |
| --- | --- |
| `.env.local` | `936fce9243db408b7034fe4223c33616023693409385fa8fe57c152d4748aca8` |
| `.data/actions.json` | `d10a63b3feb7a50e338781bbb8ffcd78bef617d14613e766f0a3bb7b04b1f449` |
| `.data/actions.schema-v1.backup.json` | `bd12bb0c8d0d6ccbd699aa8c563e56358ecaeda3ce328f8b776885c649c6a581` |
| `.data/deliverables.json` | `26f7fde6e274ede0afef940a07cf95a92fe398177bdd8350c9555ea42cf71a4c` |
| `.data/packages.json` | `ebc5e8db54ebd8010ea9072de75a045a6289622cc8fcda07f253349d841814bc` |
| `.data/projects.json` | `41c592265bf6b3482629b39417004755be9545b29f4059a68ff75c45b6bcfeec` |

Development identity database counts and canonical row fingerprints also remained identical:

| Table | Count | MD5 row fingerprint |
| --- | ---: | --- |
| `organization` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `app_user` | 1 | `72369fe7ad184c9f6612e6a0b04f4893` |
| `auth_session` | 1 | `1dd5671ea838fba53916ce60d28ec6f1` |
| `user_identity` | 1 | `856c28a1d413138c6e3fd1216c5b718a` |
| `auth_verification` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `identity_schema_migration` | 3 | `1fa89870e5a872ab0c13881deae40526` |

## Cost snapshot

Provider pricing checked on 2026-10-22; taxes and usage overages are excluded.

| Component | Current published price | Pilot control |
| --- | --- | --- |
| Vercel Pro | `$20 USD/month` for one developer seat | One seat, included credit, hard spend limit, no Password Protection add-on |
| Neon Launch | No monthly minimum; `$0.106/CU-hour`, `$0.35/GB-month` storage, `$0.20/GB-month` instant restore, `$0.09/GB-month` snapshots | Frankfurt, scale-to-zero, compute cap, notifications, delete rehearsal branch promptly |
| GitHub | Free private repositories `$0`; Team `$4 USD/user/month` if needed for required private rules | Use existing company plan when suitable; approve Team only if controls require it |
| Entra registration | No incremental price established | Confirm existing Microsoft licensing before creation |
| Combell DNS | Existing domain; no incremental price established | No domain transfer or purchase |
| SharePoint backup | Existing service; no incremental price established | Suitability and existing license must be verified before storage |

Recheck checkout totals, tax, currency, and included usage immediately before approval. Vercel usage can exceed the base fee unless a hard limit is configured. Neon cost is usage-dependent even without a monthly minimum.

## Remaining risks and blockers

- The current source repository is public and `main` is unprotected. Production integration must use the approved private company-owned destination with required CI; this has not been created or transferred.
- No Vercel, Neon, production Entra, Combell, or SharePoint control has been verified interactively because Phase A is not approved.
- Only the genuine Owner identity is currently available. Real Editor, Viewer, unapproved tenant-member, and B2B external-reviewer interactive tests remain blocked until controlled accounts exist.
- Interactive production authentication and DNS/TLS tests can occur only after approved provider setup and cutover.
- SharePoint backup suitability, retention, access control, file-size support, and separate encryption-key custody remain unverified.
- The identity transfer file contains necessary Owner PII despite credential sanitization and must be encrypted/protected and deleted when no longer needed.
- Rolling application rollback cannot reverse database writes or schema changes. A verified backup and restore rehearsal are required before cutover.

## Phase A approval boundary

The next action is approval of the first provider-side gate in `docs/owner-pilot-runbook.md`. Approval must name the exact resource/action, current cost, billing owner, spend controls, company owner, and rollback/deletion path. It does not authorize later provider gates, database writes, DNS, wider access, or email.
