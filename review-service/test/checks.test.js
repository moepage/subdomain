import { expect, test } from "vitest";
import { checkReadiness } from "../src/worker.js";

const head = "a".repeat(40);
function check(
  id,
  conclusion = "success",
  workflow = 10,
  event = "pull_request_target",
  app = 15368,
) {
  return {
    id,
    name: "review",
    status: "completed",
    conclusion,
    app: { id: app, slug: app === 15368 ? "github-actions" : "another-app" },
    details_url: `https://github.com/moepage/subdomain/actions/runs/${id}/job/${id}`,
    check_suite: { id },
    run: {
      id,
      head_sha: head,
      check_suite_id: id,
      workflow_id: workflow,
      run_number: id,
      run_attempt: 1,
      event,
    },
  };
}
function apiFor(checks, modifyRun = (run) => run) {
  return async (path) => {
    if (path.includes("/status?"))
      return {
        state: "success",
        total_count: 1,
        statuses: [{ context: "submission-format", state: "success" }],
      };
    if (path.includes("/check-runs?"))
      return { total_count: checks.length, check_runs: checks };
    if (path.startsWith("/actions/runs/"))
      return modifyRun(
        checks.find((check) => String(check.id) === path.split("/").at(-1)).run,
      );
    throw Error(`Unexpected path ${path}`);
  };
}
test("a successful description-edit run supersedes the original failure in a different suite", async () => {
  const checks = [check(1, "failure"), check(3), check(2)];
  expect(await checkReadiness(apiFor(checks), head)).toEqual({
    passed: true,
    reasons: [],
  });
});
test("latest failed or pending runs remain blockers", async () => {
  for (const latest of [
    check(3, "failure"),
    { ...check(3), status: "in_progress", conclusion: null },
  ]) {
    const result = await checkReadiness(apiFor([check(1), latest]), head);
    expect(result.passed).toBe(false);
    expect(result.reasons.join()).toContain(latest.conclusion || latest.status);
  }
});
test("same job names in different workflows, events, or apps cannot hide failures", async () => {
  for (const failed of [
    check(1, "failure", 20),
    check(1, "failure", 10, "push"),
    check(1, "failure", 10, "pull_request_target", 99),
  ]) {
    expect(
      (await checkReadiness(apiFor([failed, check(2)]), head)).passed,
    ).toBe(false);
  }
});
test("workflow identities must match the commit and check suite", async () => {
  for (const values of [
    { head_sha: "b".repeat(40) },
    { check_suite_id: 999 },
    { id: 999 },
  ]) {
    const result = await checkReadiness(
      apiFor([check(1, "failure"), check(2)], (run) => ({ ...run, ...values })),
      head,
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.join()).toContain("inconsistent");
  }
});
test("truncated check data cannot pass", async () => {
  const api = apiFor([check(1)]);
  const result = await checkReadiness(
    async (path) =>
      path.includes("/check-runs?")
        ? { total_count: 101, check_runs: [check(1)] }
        : api(path),
    head,
  );
  expect(result.passed).toBe(false);
});
