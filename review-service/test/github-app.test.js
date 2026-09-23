import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { appClient } from "../src/github-app.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_INSTALLATION_ID: "456",
  GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({
    type: "pkcs1",
    format: "pem",
  }),
  GITHUB_REPOSITORY: "moepage/subdomain",
};
afterEach(() => vi.unstubAllGlobals());

test("signs a valid short-lived App JWT and restricts installation tokens", async () => {
  const fetcher = vi.fn(async (url, options) => {
    if (url.endsWith("/access_tokens")) {
      expect(url).toBe(
        "https://api.github.com/app/installations/456/access_tokens",
      );
      const jwt = options.headers.Authorization.slice(7);
      const [header, payload, signature] = jwt.split(".");
      expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({
        alg: "RS256",
        typ: "JWT",
      });
      expect(
        verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          keys.publicKey,
          Buffer.from(signature, "base64url"),
        ),
      ).toBe(true);
      const claims = JSON.parse(Buffer.from(payload, "base64url"));
      expect(claims.iss).toBe("123");
      expect(claims.exp - claims.iat).toBe(600);
      expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
      expect(JSON.parse(options.body)).toEqual({
        repositories: ["subdomain"],
        permissions: {
          contents: "write",
          pull_requests: "write",
          checks: "read",
          statuses: "read",
        },
      });
      return Response.json({
        token: "installation-test-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    expect(options.headers.Authorization).toBe(
      "Bearer installation-test-token",
    );
    return Response.json({ number: 7 });
  });
  vi.stubGlobal("fetch", fetcher);
  const api = await appClient(config);
  expect(await api("/pulls/7")).toEqual({ number: 7 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("authentication errors and expired tokens fail closed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("denied", { status: 403 })),
  );
  await expect(appClient(config)).rejects.toThrow(
    "authentication failed (403)",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ token: "expired", expires_at: "2000-01-01T00:00:00Z" }),
    ),
  );
  await expect(appClient(config)).rejects.toThrow("invalid installation token");
  await expect(
    appClient({ ...config, GITHUB_APP_INSTALLATION_ID: "../invalid" }),
  ).rejects.toThrow("configuration");
});
