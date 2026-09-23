import { env } from "cloudflare:workers";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import worker from "../src/worker.js";
import { parseToken, sign, tokenFor } from "../src/security.js";
import migration from "../migrations/0001_reviews.sql?raw";

vi.mock("../src/github-app.js", async () => {
  const { githubClient } = await import("../../scripts/github.js");
  return {
    appClient: async (config) =>
      githubClient(config.GITHUB_TOKEN, config.GITHUB_REPOSITORY),
  };
});

const config = {
  GITHUB_REPOSITORY: "moepage/subdomain",
  GITHUB_TOKEN: "test-only",
  PUBLIC_URL: "https://review.example.com",
  REVIEW_LINK_SECRET: "local-link-secret-".repeat(3),
  REVIEW_WEBHOOK_SECRET: "local-webhook-secret-".repeat(3),
  REVIEW_EMAIL: "maintainer@example.com",
  EMAIL_FROM: "review@example.com",

  MERGE_METHOD: "squash",
};
const head = "a".repeat(40),
  base = "b".repeat(40);
const record = {
  owner: { username: "alice", email: "alice@example.com" },
  domain: "luna",
  records: { A: ["1.2.3.4"] },
  proxied: false,
};
const pr = () => ({
  number: 7,
  state: "open",
  draft: false,
  changed_files: 1,
  commits: 1,
  comments: 0,
  mergeable: true,
  mergeable_state: "clean",
  title: "<script>alert(1)</script>",
  body: "My blog",
  user: { login: "alice" },
  head: { sha: head },
  base: { sha: base, ref: "main" },
});
let mockFetch;
let sendMail;
let currentPr;
let writes;
const bindings = () => ({ ...env, ...config, EMAIL: { send: sendMail } });
const snapshot = () => ({
  pr: pr(),
  files: [
    {
      filename: "records/luna.json",
      status: "added",
      text: JSON.stringify(record),
    },
  ],
  comments: [{ user: { login: "alice" }, body: "Please review my blog." }],
});
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
async function reply(url, options = {}) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace("/repos/moepage/subdomain", "");
  if (parsed.pathname === "/graphql")
    return json({
      data: {
        repository: {
          record0: {
            text: JSON.stringify(record),
            byteSize: 100,
            isBinary: false,
          },
        },
      },
    });
  if (options.method && options.method !== "GET") {
    writes.push({ path, ...options });
    if (path.endsWith("/merge")) return json({ merged: true });
    return json({ id: "ok" });
  }
  if (path === "/pulls/7") return json(currentPr);
  if (path === "/pulls/7/files")
    return json([{ filename: "records/luna.json", status: "added" }]);
  if (path === "/pulls/7/commits")
    return json([
      { sha: head, parents: [{}], commit: { message: "Create luna.json" } },
    ]);
  if (path === `/git/trees/${base}`) return json({ tree: [] });
  if (path === `/git/trees/${head}`)
    return json({
      tree: [
        {
          path: "records/luna.json",
          mode: "100644",
          sha: "c".repeat(40),
          size: 100,
          type: "blob",
        },
      ],
    });
  if (path.startsWith("/contents/"))
    return json({
      type: "file",
      size: 100,
      encoding: "base64",
      content: Buffer.from(JSON.stringify(record)).toString("base64"),
    });
  if (path.endsWith("/status"))
    return json({
      state: "success",
      statuses: [{ context: "submission-format", state: "success" }],
    });
  if (path.endsWith("/check-runs"))
    return json({
      total_count: 1,
      check_runs: [{ status: "completed", conclusion: "success" }],
    });
  if (path === "/issues/7/comments")
    return json([
      {
        user: { login: "alice", type: "User" },
        body: "Please review my blog.",
      },
    ]);
  throw Error(`Unexpected request: ${path}`);
}
beforeEach(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
  currentPr = pr();
  writes = [];
  sendMail = vi.fn(async () => ({ messageId: "test-message" }));
  mockFetch = vi.fn(reply);
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await env.DB.exec("DROP TABLE reviews");
});
async function seeded(expires = Math.floor(Date.now() / 1000) + 3600) {
  const row = { id: crypto.randomUUID(), expires };
  await env.DB.prepare(
    "INSERT INTO reviews (id, repository, pr_number, head, base, expires, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      row.id,
      config.GITHUB_REPOSITORY,
      7,
      head,
      base,
      expires,
      JSON.stringify(snapshot()),
    )
    .run();
  return { ...row, token: await tokenFor(row, config.REVIEW_LINK_SECRET) };
}
const get = (token) =>
  worker.fetch(
    new Request(`${config.PUBLIC_URL}/review?token=${token}`),
    bindings(),
  );
const post = (token, action, more = {}, headers = {}) =>
  worker.fetch(
    new Request(`${config.PUBLIC_URL}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: config.PUBLIC_URL,
        ...headers,
      },
      body: new URLSearchParams({ token, action, ...more }),
    }),
    bindings(),
  );
async function notification(signatureOverride) {
  const body = JSON.stringify({
    repository: config.GITHUB_REPOSITORY,
    number: 7,
    head,
    base,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature =
    signatureOverride ??
    (await sign(config.REVIEW_WEBHOOK_SECRET, `${timestamp}.${body}`));
  return worker.fetch(
    new Request(`${config.PUBLIC_URL}/notify`, {
      method: "POST",
      headers: {
        "X-Review-Timestamp": timestamp,
        "X-Review-Signature": signature,
      },
      body,
    }),
    bindings(),
  );
}
test("GET repeats escaped submission details and never changes GitHub", async () => {
  const { token } = await seeded();
  const response = await get(token);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("alice@example.com");
  expect(html).toContain("luna.moe.page");
  expect(html).toContain("Please review my blog.");
  expect(html).toContain("Approve &amp; merge");
  expect(html).not.toContain("<script>");
  expect(writes).toHaveLength(0);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
});
test("rejects expired, tampered, and stale-head links", async () => {
  const { token } = await seeded();
  expect(await parseToken(`${token}x`, config.REVIEW_LINK_SECRET)).toBeNull();
  expect((await get(`${token}x`)).status).toBe(410);
  currentPr.head.sha = "c".repeat(40);
  expect((await get(token)).status).toBe(409);
  expect((await post(token, "approve")).status).toBe(409);
  const expired = await tokenFor(
    { id: crypto.randomUUID(), expires: Math.floor(Date.now() / 1000) - 1 },
    config.REVIEW_LINK_SECRET,
  );
  expect((await get(expired)).status).toBe(410);
  expect(writes).toHaveLength(0);
});
test("changed base and draft PRs cannot be approved", async () => {
  const { token } = await seeded();
  currentPr.base.sha = "c".repeat(40);
  expect((await post(token, "approve")).status).toBe(409);
  currentPr = pr();
  currentPr.draft = true;
  expect((await post(token, "approve")).status).toBe(409);
  expect(writes).toHaveLength(0);
});
test("approval submits a pinned review and merges only the checked SHA", async () => {
  const { token } = await seeded();
  expect((await post(token, "approve")).status).toBe(200);
  expect(writes.map((value) => value.path)).toEqual([
    "/pulls/7/reviews",
    "/pulls/7/merge",
  ]);
  expect(JSON.parse(writes[0].body).commit_id).toBe(head);
  expect(JSON.parse(writes[1].body).sha).toBe(head);
  expect((await post(token, "approve")).status).toBe(410);
  expect(writes).toHaveLength(2);
});
test("concurrent decisions acquire only one D1 lock", async () => {
  const { token } = await seeded();
  const results = await Promise.all([
    post(token, "approve"),
    post(token, "decline", { message: "Please revise." }),
  ]);
  expect(results.filter((response) => response.status === 200)).toHaveLength(1);
  expect(writes).toHaveLength(2);
});
test("decline posts the maintainer message before closing", async () => {
  const { token } = await seeded();
  expect(
    (
      await post(token, "decline", {
        reason:
          "The requested domain or DNS records are not suitable. Please revise your submission.",
        message: "Please choose a different domain.",
      })
    ).status,
  ).toBe(200);
  expect(JSON.parse(writes[0].body)).toMatchObject({
    event: "REQUEST_CHANGES",
    commit_id: head,
  });
  const comment = JSON.parse(writes[0].body).body;
  expect(comment).toContain("reason:  \n您好！感谢您的提交。");
  expect(comment).toContain("Domain or DNS issue  \n域名或 DNS 记录需要调整");
  expect(comment).toContain("Please choose a different domain.");
  expect(comment).toContain(
    "Thank you for understanding~(∠·ω< )⌒★  \n处理完这些反馈后",
  );
  expect(comment.endsWith("感谢您的理解～(∠·ω< )⌒★")).toBe(true);
  expect(JSON.parse(writes[1].body)).toEqual({ state: "closed" });
});
test("a custom decline reason omits the selector sentinel", async () => {
  const { token } = await seeded();
  expect(
    (
      await post(token, "decline", {
        reason: "custom",
        message: "Please explain how this domain will be used.",
      })
    ).status,
  ).toBe(200);
  const body = JSON.parse(writes[0].body).body;
  expect(body).toContain("Please explain how this domain will be used.");
  expect(body).not.toContain("custom");
});
test("missing decline message and cross-site submissions make no changes", async () => {
  const { token } = await seeded();
  expect((await post(token, "decline", { reason: "custom" })).status).toBe(400);
  expect(
    (await post(token, "approve", {}, { Origin: "https://evil.example" }))
      .status,
  ).toBe(403);
  expect(writes).toHaveLength(0);
});
test("failed or pending checks block merge", async () => {
  const { token } = await seeded();
  mockFetch.mockImplementation(async (url, options) =>
    String(url).includes("/check-runs")
      ? json({
          total_count: 1,
          check_runs: [{ status: "in_progress", conclusion: null }],
        })
      : reply(url, options),
  );
  expect((await post(token, "approve")).status).toBe(409);
  expect(writes).toHaveLength(0);
});
test("ambiguous merge failures lock the link for manual recovery", async () => {
  const { token } = await seeded();
  mockFetch.mockImplementation(async (url, options) =>
    String(url).endsWith("/merge")
      ? new Response("unavailable", { status: 502 })
      : reply(url, options),
  );
  expect((await post(token, "approve")).status).toBe(502);
  expect((await post(token, "approve")).status).toBe(410);
});
test("signed notifications send complete email once per revision", async () => {
  expect((await notification()).status).toBe(200);
  expect((await notification()).status).toBe(200);
  expect(sendMail).toHaveBeenCalledTimes(1);
  const mail = sendMail.mock.calls[0][0];
  for (const text of [
    "alice@example.com",
    "luna.moe.page",
    "1.2.3.4",
    "My blog",
    "Please review my blog.",
    "/review?token=",
    "#decline",
  ])
    expect(mail.text).toContain(text);
  expect(mail.to).toEqual(config.REVIEW_EMAIL);
  expect(mail.html).not.toContain("<script>");
});
test("unsigned notification is rejected without GitHub or email requests", async () => {
  expect((await notification("0".repeat(64))).status).toBe(401);
  expect(mockFetch).not.toHaveBeenCalled();
});
test("uncertain email failures are locked instead of blindly retried", async () => {
  sendMail.mockRejectedValue(new Error("provider unavailable"));
  expect((await notification()).status).toBe(502);
  expect((await notification()).status).toBe(503);
  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(
    (await env.DB.prepare("SELECT email_sent FROM reviews").first()).email_sent,
  ).toBe(-1);
});
test("concurrent notifications send only one email", async () => {
  const results = await Promise.all([notification(), notification()]);
  expect(results.some((response) => response.status === 200)).toBe(true);
  expect(sendMail).toHaveBeenCalledTimes(1);
});
test("a push after approval review prevents the merge", async () => {
  const { token } = await seeded();
  mockFetch.mockImplementation(async (url, options) => {
    const response = await reply(url, options);
    if (String(url).endsWith("/reviews") && options?.method === "POST")
      currentPr.head.sha = "d".repeat(40);
    return response;
  });
  expect((await post(token, "approve")).status).toBe(502);
  expect(writes.map((value) => value.path)).toEqual(["/pulls/7/reviews"]);
});
test("failed independent validation prevents both email and merge", async () => {
  const { token } = await seeded();
  currentPr.body = "";
  expect((await post(token, "approve")).status).toBe(409);
  expect((await notification()).status).toBe(409);
  expect(writes).toHaveLength(0);
});
test("expired notifications create fresh links when the workflow is rerun", async () => {
  const row = await seeded(Math.floor(Date.now() / 1000) - 1);
  expect((await notification()).status).toBe(200);
  expect(
    await env.DB.prepare("SELECT * FROM reviews WHERE id = ?")
      .bind(row.id)
      .first(),
  ).toBeNull();
  const mail = sendMail.mock.calls[0][0];
  expect(mail.text).not.toContain(row.token);
});
test("oversized and wrong-method requests do not trigger mutations", async () => {
  expect(
    (
      await worker.fetch(
        new Request(`${config.PUBLIC_URL}/notify`, {
          method: "POST",
          body: "a".repeat(4097),
        }),
        bindings(),
      )
    ).status,
  ).toBe(500);
  expect(
    (
      await worker.fetch(
        new Request(`${config.PUBLIC_URL}/decision?token=fake`),
        bindings(),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request(`${config.PUBLIC_URL}/review?token=fake`, {
          method: "HEAD",
        }),
        bindings(),
      )
    ).status,
  ).toBe(404);
  expect(writes).toHaveLength(0);
});

test("inappropriate-content preset posts bilingual feedback before closing", async () => {
  const { token } = await seeded();
  expect(
    (
      await post(token, "decline", {
        reason: "inappropriate-content",
        message: "Please remove the unsuitable material.",
      })
    ).status,
  ).toBe(200);
  const comment = JSON.parse(writes[0].body).body;
  expect(comment).toContain("Inappropriate content  \n网站包含不适宜的内容");
  expect(comment).toContain("Please remove the unsuitable material.");
  expect(writes.map((item) => item.path)).toEqual([
    "/pulls/7/reviews",
    "/pulls/7",
  ]);
});
test("unknown decline presets cannot silently replace bilingual reasons", async () => {
  const { token } = await seeded();
  expect(
    (await post(token, "decline", { reason: "unknown", message: "A note" }))
      .status,
  ).toBe(400);
  expect(writes).toHaveLength(0);
});
