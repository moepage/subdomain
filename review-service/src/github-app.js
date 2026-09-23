import { createPrivateKey } from "node:crypto";
import { githubClient } from "../../scripts/github.js";

const encoded = (value) => Buffer.from(value).toString("base64url");

// Mint per request: no cross-request credential or promise state in the isolate.
export async function appClient(env) {
  if (
    !/^\d+$/.test(env.GITHUB_APP_ID ?? "") ||
    !/^\d+$/.test(env.GITHUB_APP_INSTALLATION_ID ?? "") ||
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "")
  )
    throw new Error("GitHub App configuration is missing or invalid.");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encoded(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${encoded(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  // GitHub downloads PKCS#1 PEM; Web Crypto requires PKCS#8.
  const pem = createPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pem.export({ type: "pkcs8", format: "der" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(payload),
  );
  const response = await fetch(
    `https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload}.${encoded(new Uint8Array(signature))}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "moe-page-review",
      },
      body: JSON.stringify({
        repositories: [env.GITHUB_REPOSITORY.split("/")[1]],
        permissions: {
          contents: "write",
          pull_requests: "write",
          checks: "read",
          statuses: "read",
        },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub App authentication failed (${response.status}).`);
  const result = await response.json();
  if (
    typeof result.token !== "string" ||
    !result.token ||
    Date.parse(result.expires_at) <= Date.now() ||
    !Number.isFinite(Date.parse(result.expires_at))
  )
    throw new Error("GitHub returned an invalid installation token.");
  return githubClient(result.token, env.GITHUB_REPOSITORY);
}
