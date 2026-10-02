import assert from "node:assert/strict";
import { test } from "node:test";
import { createBachsClient } from "../dist/bachs/index.js";
import { startLocalAdmin } from "../dist/server/local-admin.js";
import { hostDatabase, testStore } from "./helpers.mjs";

test("local admin binds to loopback, exchanges one-use access, and protects owner routes", async (t) => {
  const host = await hostDatabase(t, "sqlite");
  const connection = host.connect();
  const store = await testStore(host, connection);
  const bachs = createBachsClient({
    organizationId: "acct_owner",
    environment: "sandbox",
    secretKey: "sk_sandbox_local_admin_test",
  });
  const app = await startLocalAdmin(
    {
      store,
      bachs,
      siteName: "<Notes & Books>",
    },
    { port: 0 },
  );
  t.after(() => app.close());

  assert.match(app.origin, /^http:\/\/localhost:\d+$/);
  const page = await fetch(app.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /site-name="&lt;Notes &amp; Books&gt;"/);
  assert.equal(
    page.headers
      .get("content-security-policy")
      ?.includes("frame-ancestors 'none'"),
    true,
  );

  const denied = await fetch(`${app.origin}/api/owner/summary`);
  assert.equal(denied.status, 403);
  assert.equal(
    denied.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );

  const asset = await fetch(`${app.origin}/ui/define.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type"), /javascript/);

  const login = await fetch(app.accessUrl, { redirect: "manual" });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/");
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes("Secure"), false, "loopback HTTP has no TLS");

  const repeatedLogin = await fetch(app.accessUrl, { redirect: "manual" });
  assert.equal(repeatedLogin.status, 403);

  const summary = await fetch(`${app.origin}/api/owner/summary`, {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(summary.status, 200);
  assert.equal((await summary.json()).contributions.confirmed, 0);

  const crossSite = await fetch(`${app.origin}/api/owner/summary`, {
    headers: {
      Cookie: cookie.split(";")[0],
      "Sec-Fetch-Site": "cross-site",
    },
  });
  assert.equal(crossSite.status, 403);
});
