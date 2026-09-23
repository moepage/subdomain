import { test } from "node:test";
import assert from "node:assert/strict";
import {
  submissionComment,
  translateError,
} from "../scripts/submission-comment.js";
const input = {
  pr: {
    number: 42,
    head: { sha: "a".repeat(40) },
    base: { sha: "b".repeat(40) },
  },
  repository: "moepage/subdomain",
  runUrl: "https://github.com/moepage/subdomain/actions/runs/1",
  reviewer: "maoawa",
  passed: false,
};
test("missing-description feedback points to the opening message and automatic recheck", () => {
  const body = submissionComment({
    ...input,
    errors: ["Describe the purpose of your website in the PR description."],
  });
  assert.match(body, /first message at the top/);
  assert.match(body, /页面顶部的第一条消息/);
  assert.match(body, /⋯ → Edit/);
  assert.match(body, /Update comment/);
  assert.match(body, /A separate comment does not satisfy/);
  assert.match(body, /另发一条评论不能替代/);
  assert.match(body, /automatically reruns/);
  assert.match(body, /human|Human/);
  assert.match(body, /@maoawa/);
  assert.ok(body.indexOf("What to do next") < body.indexOf("Checked revision"));
});
test("JSON errors and manual-review feedback have Chinese lines and actionable next steps", () => {
  const body = submissionComment({
    ...input,
    errors: [
      "records/luna.json: Invalid JSON.",
      "records/luna.json: owner.username must match the PR author; delegated submissions need manual review.",
    ],
  });
  assert.match(body, /records\/luna.json：JSON 格式无效/);
  assert.match(body, /代他人申请需要人工审核/);
  assert.match(body, /same branch/);
  assert.match(body, /leave a comment in this PR explaining/);
});
test("passing comments ask applicants to wait rather than edit or reopen", () => {
  const body = submissionComment({ ...input, passed: true });
  assert.match(body, /Please wait for a maintainer/);
  assert.match(body, /请等待管理员/);
  assert.doesNotMatch(body, /What to do next|Update comment/);
});
test("dynamic errors are translated and untrusted error text cannot inject mentions or markup", () => {
  assert.equal(
    translateError(
      "records/luna.json: removing/replacing A values requires manual DNS cleanup.",
    ),
    "records/luna.json：删除或替换 A 的值需要管理员手动清理旧 DNS 记录。",
  );
  assert.match(
    translateError("Validation could not finish: GitHub request failed (403)."),
    /GitHub 请求失败（状态码 403）/,
  );
  const body = submissionComment({
    ...input,
    errors: ["records/@everyone<script>.json: Invalid JSON."],
  });
  assert.doesNotMatch(body, /@everyone|<script>/);
});
