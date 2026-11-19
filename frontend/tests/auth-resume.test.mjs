import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError } from "axios";
import { createPinia } from "pinia";
import { authService } from "../src/services/auth.service.ts";
import { useAuthStore } from "../src/stores/auth.store.ts";

const user = {
  id: "athlete",
  email: "athlete@example.test",
  status: "ACTIVE",
  createdAt: "",
  updatedAt: "",
};
function activeSession() {
  const auth = useAuthStore(createPinia());
  auth.user = user;
  auth.accessToken = "existing-access";
  auth.status = "authenticated";
  return auth;
}
const unauthorized = () =>
  new AxiosError("401", undefined, undefined, undefined, { status: 401 });

test("resume probes the server without rotating a valid access token", async (t) => {
  const auth = activeSession();
  const me = t.mock.method(authService, "me", async () => user);
  const refresh = t.mock.method(authService, "refresh", async () =>
    assert.fail("unexpected rotation"),
  );
  await auth.verifySession();
  assert.deepEqual(me.mock.calls[0].arguments, ["existing-access"]);
  assert.equal(refresh.mock.callCount(), 0);
  assert.equal(auth.status, "authenticated");
});

test("expired credentials on resume clear the private account after one refresh attempt", async (t) => {
  const auth = activeSession();
  t.mock.method(authService, "me", async () => {
    throw unauthorized();
  });
  t.mock.method(authService, "context", async () => ({
    contextId: "context",
    csrfToken: "csrf",
  }));
  const refresh = t.mock.method(authService, "refresh", async () => {
    throw unauthorized();
  });
  await assert.rejects(auth.verifySession());
  assert.equal(refresh.mock.callCount(), 1);
  assert.equal(auth.status, "anonymous");
  assert.equal(auth.user, null);
  assert.equal(auth.accessToken, null);
});

test("a delayed resume rejection from a closed session cannot rotate the next account", async (t) => {
  const auth = activeSession();
  let rejectMe;
  t.mock.method(
    authService,
    "me",
    () =>
      new Promise((_, reject) => {
        rejectMe = reject;
      }),
  );
  const refresh = t.mock.method(authService, "refresh", async () =>
    assert.fail("old session rotated"),
  );
  const pending = auth.verifySession();
  auth.clearSession();
  auth.user = { ...user, id: "next" };
  auth.accessToken = "next-access";
  auth.status = "authenticated";
  rejectMe(unauthorized());
  await assert.rejects(pending);
  assert.equal(refresh.mock.callCount(), 0);
  assert.equal(auth.user.id, "next");
});

test("a return path stays within authenticated application routes", async () => {
  const { authReturnPath } = await import("../src/utils/auth-return-path.ts");
  assert.equal(
    authReturnPath("/app/profile?tab=datos#account"),
    "/app/profile?tab=datos#account",
  );
  for (const value of [
    "//other.test",
    "/app\\elsewhere",
    "/app/%2e%2e/login",
    "/login",
    ["app"],
  ])
    assert.equal(authReturnPath(value), "/app/overview");
});

test("an offline resume keeps credentials in memory for a later verification", async (t) => {
  const auth = activeSession();
  t.mock.method(authService, "me", async () => {
    throw new AxiosError("offline", AxiosError.ERR_NETWORK);
  });
  await assert.rejects(auth.verifySession(), /offline/);
  assert.equal(auth.status, "authenticated");
});

test("a restored tab checks its cookie session after verifying the bearer", async (t) => {
  const auth = useAuthStore(createPinia());
  let contextId = "initial-context";
  t.mock.method(authService, "login", async () => ({
    user,
    accessToken: "original",
    csrfToken: "csrf",
  }));
  t.mock.method(authService, "me", async () => user);
  t.mock.method(authService, "context", async () => ({
    contextId,
    csrfToken: "csrf",
  }));
  await auth.login({ email: user.email, password: "test-password" });
  contextId = "different-context";
  await assert.rejects(auth.verifySession(), /sesión del navegador cambió/);
  assert.equal(auth.status, "anonymous");
  assert.equal(auth.user, null);
});
