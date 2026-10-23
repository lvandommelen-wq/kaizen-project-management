import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readMicrosoftClaims } from "../src/lib/microsoft-identity.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const objectId = "20000000-0000-4000-8000-000000000001";

function profile(overrides = {}) {
  return {
    tid: tenantId,
    oid: objectId,
    sub: "microsoft-provider-subject",
    acct: 0,
    ...overrides,
  };
}

test("Microsoft email claim is preferred and normalized", () => {
  const claims = readMicrosoftClaims(profile({
    email: "  Primary.User@Example.COM ",
    preferred_username: "different.user@example.com",
  }), tenantId);

  assert.equal(claims.email, "primary.user@example.com");
});

test("Microsoft preferred_username supplies a missing email claim", () => {
  const claims = readMicrosoftClaims(profile({
    preferred_username: "Test.User@Example.COM",
  }), tenantId);

  assert.equal(claims.email, "test.user@example.com");
});

test("Microsoft preferred_username supplies an empty email claim", () => {
  const claims = readMicrosoftClaims(profile({
    email: "   ",
    preferred_username: "fallback.user@example.com",
  }), tenantId);

  assert.equal(claims.email, "fallback.user@example.com");
});

test("Microsoft identity fails closed without a usable email address", () => {
  assert.throws(
    () => readMicrosoftClaims(profile(), tenantId),
    /usable email address/,
  );
  assert.throws(
    () => readMicrosoftClaims(profile({ preferred_username: "not-an-email" }), tenantId),
    /usable email address/,
  );
});

test("Microsoft tenant, object and subject validation remains authoritative", () => {
  assert.throws(
    () => readMicrosoftClaims(profile({
      tid: "10000000-0000-4000-8000-000000000002",
      email: "user@example.com",
    }), tenantId),
    /unexpected tenant/,
  );
  assert.throws(
    () => readMicrosoftClaims(profile({ oid: "invalid", email: "user@example.com" }), tenantId),
    /expected object ID/,
  );
  assert.throws(
    () => readMicrosoftClaims(profile({ sub: "", email: "user@example.com" }), tenantId),
    /provider subject/,
  );
  assert.throws(
    () => readMicrosoftClaims(
      profile({ email: "user@example.com" }),
      tenantId,
      "20000000-0000-4000-8000-000000000002",
    ),
    /expected object ID/,
  );
});

test("matching email text never replaces the Microsoft object identity", () => {
  const first = readMicrosoftClaims(profile({ email: "shared@example.com" }), tenantId);
  const second = readMicrosoftClaims(profile({
    oid: "20000000-0000-4000-8000-000000000002",
    email: "shared@example.com",
  }), tenantId);

  assert.notEqual(first.objectId, second.objectId);
  assert.equal(first.email, second.email);
});

test("authentication does not enable email account linking or operational access", async () => {
  const authSource = await readFile(
    path.join(process.cwd(), "src", "lib", "auth.ts"),
    "utf8",
  );

  assert.match(authSource, /accountLinking:\s*\{\s*enabled:\s*false/);
  assert.match(authSource, /providerObjectId:\s*claims\.objectId/);
  assert.match(authSource, /providerSubject:\s*claims\.subject/);
  assert.doesNotMatch(authSource, /access_grant|project_membership/);
});

test("Access Management uses completed Microsoft identity validation, not fallback email verification", async () => {
  const [accessManagementSource, accessAuthorizationSource] = await Promise.all([
    readFile(path.join(process.cwd(), "src", "lib", "access-management.ts"), "utf8"),
    readFile(path.join(process.cwd(), "src", "lib", "access-authorization.ts"), "utf8"),
  ]);

  assert.doesNotMatch(accessManagementSource, /app_user\.email_verified\s*=\s*true/);
  assert.match(accessManagementSource, /app_user\.last_authenticated_at IS NOT NULL/);
  assert.match(accessManagementSource, /user_identity\.provider = 'microsoft'/);
  assert.doesNotMatch(accessAuthorizationSource, /app_user\.email_verified\s*=\s*true/);
  assert.match(accessAuthorizationSource, /app_user\.last_authenticated_at IS NOT NULL/);
  assert.match(accessAuthorizationSource, /user_identity\.provider = 'microsoft'/);
});
