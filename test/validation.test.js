import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRecord,
  validateSubmission,
} from "../scripts/validate-submission.js";
import { collectReview } from "../scripts/github.js";
const record = () => ({
  owner: { username: "alice", email: "alice@example.com" },
  domain: "luna",
  records: { A: ["1.2.3.4"] },
  proxied: false,
});
const file = (config) => ({
  filename: `records/${config.domain}.json`,
  status: "added",
  text: JSON.stringify(config),
});
const submission = (overrides = {}) => ({
  author: "alice",
  body: "My personal blog.",
  commits: [
    {
      sha: "a".repeat(40),
      parents: [{}],
      commit: { message: "Create luna.json" },
    },
  ],
  files: [file(record())],
  ...overrides,
});
const check = (config) =>
  validateRecord(`records/${config.domain}.json`, JSON.stringify(config))
    .errors;
test("accepts valid A, AAAA, CNAME, TXT, nested and verification labels", () => {
  for (const records of [
    { A: ["1.2.3.4"] },
    { AAAA: ["2001:db8::1"] },
    { CNAME: "alice.github.io" },
    { TXT: ["hello"] },
    { A: ["1.2.3.4"], TXT: ["hello"] },
  ])
    assert.deepEqual(check({ ...record(), records }), []);
  for (const domain of ["wiki.luna", "_atproto.luna", "_vercel.luna"])
    assert.deepEqual(check({ ...record(), domain }), []);
  assert.equal(validateSubmission(submission()).passed, true);
});
test("rejects malformed JSON, schema, filenames, and unsafe values", () => {
  assert.ok(validateRecord("records/luna.json", "{").errors.length);
  assert.ok(
    validateRecord("records/other.json", JSON.stringify(record())).errors
      .length,
  );
  for (const patch of [
    { domain: "../../x" },
    { domain: "Luna" },
    { domain: "-luna" },
    { owner: { username: "bad/name" } },
    { owner: { username: 123 } },
    { owner: { username: "alice", email: 1 } },
    { proxied: "false" },
    { ttl: 3 },
    { surprise: true },
    { records: {} },
    { records: { A: ["999.2.3.4"] } },
    { records: { AAAA: ["1.2.3.4"] } },
    { records: { CNAME: ["https://example.com"] } },
    { records: { CNAME: ["luna.moe.page"] } },
    { records: { CNAME: ["1.2.3.4"] } },
    { records: { CNAME: ["one.example", "two.example"] } },
    { records: { CNAME: "example.com", TXT: ["hello"] } },
    { records: { A: [] } },
    { records: { A: [1] } },
    { records: { A: ["1.2.3.4", "1.2.3.4"] } },
    { records: { MX: ["mail.example.com"] } },
    { records: { TXT: ["hello"] }, proxied: true },
  ])
    assert.ok(check({ ...record(), ...patch }).length, JSON.stringify(patch));
});
test("checks commits, author, PR description, base and file scope", () => {
  for (const patch of [
    { author: "bob" },
    { body: "<!-- template -->" },
    { baseRef: "dev" },
    { draft: true },
    { files: [] },
    { files: [{ filename: "scripts/malicious.js", status: "added" }] },
    { files: [{ ...file(record()), status: "removed" }] },
    { commits: [{ sha: "a".repeat(40), commit: { message: "   " } }] },
  ])
    assert.equal(validateSubmission(submission(patch)).passed, false);
  for (const message of [
    "add(luna): add my blog",
    "fix(luna): update target",
    "Update luna.json",
    "Add luna.json for DNS record configuration",
  ])
    assert.equal(
      validateSubmission(
        submission({ commits: [{ sha: "a".repeat(40), commit: { message } }] }),
      ).passed,
      true,
    );
  assert.equal(
    validateSubmission(
      submission({
        commits: [
          {
            sha: "a".repeat(40),
            parents: [{}, {}],
            commit: { message: "Merge branch 'main'" },
          },
        ],
      }),
    ).passed,
    true,
  );
});
test("rejects namespace takeovers and ownership changes, accepts own nested names", () => {
  const candidate = { ...record(), domain: "wiki.luna" };
  for (const domain of ["luna", "wiki.luna", "child.wiki.luna"])
    assert.equal(
      validateSubmission(
        submission({
          files: [file(candidate)],
          commits: [
            {
              sha: "a".repeat(40),
              commit: { message: "Create wiki.luna.json" },
            },
          ],
          existing: [
            { filename: `records/${domain}.json`, domain, owner: "bob" },
          ],
        }),
      ).passed,
      false,
    );
  assert.equal(
    validateSubmission(
      submission({
        files: [file(candidate)],
        commits: [
          { sha: "a".repeat(40), commit: { message: "Create wiki.luna.json" } },
        ],
        existing: [
          { filename: "records/luna.json", domain: "luna", owner: "alice" },
        ],
      }),
    ).passed,
    true,
  );
});
test("blocks changes the deployment cannot clean up, allows CNAME updates", () => {
  assert.equal(
    validateSubmission(
      submission({
        files: [
          {
            ...file(record()),
            status: "modified",
            previousText: JSON.stringify({
              ...record(),
              records: { A: ["1.2.3.4", "1.2.3.5"] },
            }),
          },
        ],
      }),
    ).passed,
    false,
  );
  assert.equal(
    validateSubmission(
      submission({
        files: [
          {
            ...file(record()),
            status: "modified",
            previousText: JSON.stringify({
              ...record(),
              records: { CNAME: "old.example.com" },
            }),
          },
        ],
      }),
    ).passed,
    false,
  );
  const cname = { ...record(), records: { CNAME: "new.example.com" } };
  assert.equal(
    validateSubmission(
      submission({
        files: [
          {
            ...file(cname),
            status: "modified",
            previousText: JSON.stringify({
              ...cname,
              records: { CNAME: "old.example.com" },
            }),
          },
        ],
      }),
    ).passed,
    true,
  );
});
test("fails closed on truncated GitHub data", async () => {
  const pr = {
    state: "open",
    changed_files: 1,
    commits: 1,
    head: { sha: "head" },
    base: { sha: "base" },
  };
  const api = async (path) =>
    path === "/pulls/1"
      ? pr
      : path.includes("/files")
        ? [{}]
        : path.includes("/commits")
          ? [{}]
          : { truncated: true };
  assert.equal((await collectReview(api, 1)).passed, false);
});
test("rejects symlink records before fetching their contents", async () => {
  const pr = {
    state: "open",
    changed_files: 1,
    commits: 1,
    head: { sha: "head" },
    base: { sha: "base" },
  };
  const api = async (path) => {
    if (path === "/pulls/1") return pr;
    if (path.includes("/files")) return [file(record())];
    if (path.includes("/commits")) return [{}];
    if (path.includes("/git/trees/"))
      return {
        tree: [{ path: "records/luna.json", type: "blob", mode: "120000" }],
      };
    throw Error("Must not read symlinks");
  };
  assert.match((await collectReview(api, 1)).errors[0], /regular/);
});
test("accepts ordinary multilingual commit messages without a special convention", () => {
  for (const message of [
    "Add my blog",
    "hello",
    "修正博客的 DNS 记录",
    "Create luna.json",
    "update: DNS target",
  ]) {
    assert.equal(
      validateSubmission(
        submission({ commits: [{ sha: "a".repeat(40), commit: { message } }] }),
      ).passed,
      true,
    );
  }
  for (const message of ["", " ", "a".repeat(201), "unsafe\x00title"]) {
    assert.equal(
      validateSubmission(
        submission({ commits: [{ sha: "a".repeat(40), commit: { message } }] }),
      ).passed,
      false,
    );
  }
});
test("legacy records without domain reserve their filenames without blocking unrelated requests", async () => {
  const pr = {
    state: "open",
    draft: false,
    body: "My blog.",
    user: { login: "alice" },
    changed_files: 1,
    commits: 1,
    head: { sha: "head" },
    base: { sha: "base", ref: "main" },
  };
  let legacyName = "legacy";
  const api = async (path) => {
    if (path === "/pulls/1") return pr;
    if (path.includes("/files")) return [file(record())];
    if (path.includes("/commits")) return submission().commits;
    if (path.includes("/git/trees/"))
      return {
        tree: [
          {
            path: `records/${path.includes("/base?") ? legacyName : "luna"}.json`,
            type: "blob",
            mode: "100644",
          },
        ],
      };
    if (path.includes("/contents/"))
      return {
        type: "file",
        encoding: "base64",
        size: 100,
        content: Buffer.from(
          JSON.stringify(
            path.endsWith("ref=base")
              ? {
                  owner: { username: "bob" },
                  record: { CNAME: "old.example.com" },
                }
              : record(),
          ),
        ).toString("base64"),
      };
    throw Error(`Unexpected API path: ${path}`);
  };
  assert.equal((await collectReview(api, 1)).passed, true);
  legacyName = "luna";
  const result = await collectReview(api, 1);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("another owner")));
});
