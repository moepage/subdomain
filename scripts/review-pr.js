import fs from "node:fs";
import { createHmac } from "node:crypto";
import { collectReview, githubClient } from "./github.js";

import { marker, submissionComment } from "./submission-comment.js";
const event = JSON.parse(
  fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
);
const number =
  event.pull_request?.number ?? Number(process.env.INPUT_PR_NUMBER);
if (!Number.isSafeInteger(number) || number < 1)
  throw new Error("A valid PR number is required.");
const repository = process.env.GITHUB_REPOSITORY;
const api = githubClient(process.env.GITHUB_TOKEN, repository);
let review;
try {
  review = await collectReview(api, number);
} catch (error) {
  review = {
    pr: await api(`/pulls/${number}`),
    passed: false,
    errors: [`Validation could not finish: ${error.message}`],
  };
}
const { pr, passed, errors } = review;
const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const body = submissionComment({
  pr,
  passed,
  errors,
  repository,
  runUrl,
  reviewer: process.env.REVIEWER_LOGIN,
});
// Update a bot-owned comment only; never edit an applicant's copied marker.
let previous;
for (let page = 1; page <= 10; page++) {
  const comments = await api(
    `/issues/${number}/comments?per_page=100&page=${page}`,
  );
  previous = comments.find(
    (comment) =>
      comment.user.login === "github-actions[bot]" &&
      comment.body.startsWith(marker),
  );
  if (previous || comments.length < 100) break;
}
if (previous)
  await api(`/issues/comments/${previous.id}`, {
    method: "PATCH",
    body: { body },
  });
else
  await api(`/issues/${number}/comments`, { method: "POST", body: { body } });
await api(`/statuses/${pr.head.sha}`, {
  method: "POST",
  body: {
    state: passed ? "success" : "failure",
    context: "submission-format",
    description: passed
      ? "Submission format passed; maintainer review required."
      : "Fix submission errors or request manual review.",
    target_url: runUrl,
  },
});
if (
  passed &&
  process.env.REVIEW_SERVICE_URL &&
  process.env.REVIEW_WEBHOOK_SECRET
) {
  const endpoint = new URL("/notify", process.env.REVIEW_SERVICE_URL);
  if (endpoint.protocol !== "https:")
    throw new Error("Review service must use HTTPS.");
  const payload = JSON.stringify({
    repository,
    number,
    head: pr.head.sha,
    base: pr.base.sha,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", process.env.REVIEW_WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Review-Timestamp": timestamp,
      "X-Review-Signature": signature,
    },
    body: payload,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(
      `Review email service failed (${response.status}); rerun the workflow after fixing configuration.`,
    );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "Submission passed; the email service accepted the notification.\n",
  );
} else if (passed) {
  console.log(
    "::warning::Email review is not configured. Set REVIEW_SERVICE_URL and REVIEW_WEBHOOK_SECRET.",
  );
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    "Submission passed. Email skipped: configure REVIEW_SERVICE_URL and REVIEW_WEBHOOK_SECRET.\n",
  );
}
if (!passed) process.exitCode = 1;
