import { test } from "node:test";
import assert from "node:assert/strict";
import { githubClient } from "../scripts/github.js";

const entry = (index) => ({
  path: `records/test${index}.json`,
  sha: index.toString(16).padStart(40, "0"),
  mode: "100644",
  type: "blob",
  size: 2,
});
test("record reads batch immutable blobs in groups of 50", async () => {
  let calls = 0;
  const api = githubClient(
    "test",
    "moepage/subdomain",
    async (url, options) => {
      assert.equal(url, "https://api.github.com/graphql");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.variables, { owner: "moepage", name: "subdomain" });
      const fields = [
        ...body.query.matchAll(/(record\d+): object\(oid: "([a-f\d]{40})"\)/g),
      ];
      assert.equal(fields.length, calls++ === 0 ? 50 : 1);
      return Response.json({
        data: {
          repository: Object.fromEntries(
            fields.map(([_, alias]) => [
              alias,
              { text: "{}", byteSize: 2, isBinary: false },
            ]),
          ),
        },
      });
    },
  );
  assert.equal(
    (await api.readRecords(Array.from({ length: 51 }, (_, i) => entry(i))))
      .size,
    51,
  );
  assert.equal(calls, 2);
});
test("partial GraphQL data, binary blobs, and oversized records fail closed", async () => {
  for (const result of [
    { errors: [{ message: "partial" }], data: { repository: {} } },
    { data: { repository: {} } },
    {
      data: {
        repository: { record0: { text: "{}", byteSize: 2, isBinary: true } },
      },
    },
    {
      data: {
        repository: {
          record0: {
            text: "a".repeat(32769),
            byteSize: 32769,
            isBinary: false,
          },
        },
      },
    },
  ]) {
    const api = githubClient("test", "moepage/subdomain", async () =>
      Response.json(result),
    );
    await assert.rejects(api.readRecords([entry(1)]));
  }
  const api = githubClient("test", "moepage/subdomain", () => {
    throw Error("must not fetch");
  });
  await assert.rejects(
    api.readRecords([{ ...entry(1), mode: "120000" }]),
    /regular JSON blob/,
  );
});
