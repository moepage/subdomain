import { collectReview } from "../../scripts/github.js";
import { appClient } from "./github-app.js";
import {
  approvalComment,
  declineComment,
  squashCommitMessage,
} from "./messages.js";
import {
  allowedFormOrigin,
  boundedText,
  parseToken,
  tokenFor,
  verify,
} from "./security.js";
import { details, detailsText, escape, page, reviewPage } from "./views.js";

const now = () => Math.floor(Date.now() / 1000);
const prUrl = (env, number) =>
  `https://github.com/${env.GITHUB_REPOSITORY}/pull/${number}`;

const problem = (message, status = 409) =>
  page("Review unavailable", `<p>${escape(message)}</p>`, status);

function descriptionChanged(pr, snapshot) {
  return (
    (pr.body ?? "") !== (snapshot.description ?? snapshot.pr.body ?? "") ||
    pr.title !== snapshot.pr.title
  );
}

async function current(api, row) {
  const pr = await api(`/pulls/${row.pr_number}`);
  if (
    pr.state !== "open" ||
    pr.draft ||
    pr.head.sha !== row.head ||
    pr.base.sha !== row.base ||
    pr.base.ref !== "main" ||
    descriptionChanged(pr, JSON.parse(row.snapshot))
  )
    throw new Error(
      "The PR is closed, draft, or has changed. Use a fresh review email.",
    );
  return pr;
}

export async function checkReadiness(api, head) {
  const [status, checks] = await Promise.all([
    api(`/commits/${head}/status?per_page=100`),
    api(`/commits/${head}/check-runs?per_page=100&filter=latest`),
  ]);
  const reasons = [];
  if (checks.total_count > 100 || status.total_count > 100)
    return {
      passed: false,
      reasons: ["Too many checks to verify here. Review the checks on GitHub."],
    };
  for (const item of status.statuses)
    if (item.state !== "success")
      reasons.push(`Commit status “${item.context}” is ${item.state}.`);
  if (
    !status.statuses.some(
      (item) =>
        item.context === "submission-format" && item.state === "success",
    )
  )
    reasons.push("The submission-format check has not passed yet.");
  if (status.state !== "success" && !reasons.length)
    reasons.push(`GitHub reports commit statuses as ${status.state}.`);

  // GitHub's filter=latest is per check suite, not per workflow across events.
  // A description edit can create another suite on the same commit. Resolve
  // duplicate Actions job names to workflow identities before replacing a run;
  // unrelated workflows/apps with the same job name must never mask failures.
  const groups = new Map();
  for (const check of checks.check_runs) {
    const key = JSON.stringify([check.app?.id, check.name]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(check);
  }
  const candidates = checks.check_runs.filter(
    (check) =>
      check.app?.id === 15368 &&
      check.app?.slug === "github-actions" &&
      groups.get(JSON.stringify([check.app.id, check.name])).length > 1,
  );
  const runIds = new Map();
  for (const check of candidates) {
    const match =
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/job\/\d+$/.exec(
        check.details_url ?? "",
      );
    if (!match)
      return {
        passed: false,
        reasons: [
          "Cannot identify repeated workflow checks. Open GitHub to review them.",
        ],
      };
    runIds.set(check.id, match[1]);
  }
  if (new Set(runIds.values()).size > 20)
    return {
      passed: false,
      reasons: [
        "Too many repeated workflow runs to verify here. Review them on GitHub.",
      ],
    };
  const runs = new Map(
    await Promise.all(
      [...new Set(runIds.values())].map(async (id) => [
        id,
        await api(`/actions/runs/${id}`),
      ]),
    ),
  );
  const latest = new Map();
  const independent = checks.check_runs.filter(
    (check) => !runIds.has(check.id),
  );
  for (const check of candidates) {
    const run = runs.get(runIds.get(check.id));
    if (
      String(run.id) !== runIds.get(check.id) ||
      run.head_sha !== head ||
      run.check_suite_id !== check.check_suite?.id ||
      !Number.isSafeInteger(run.workflow_id) ||
      !Number.isSafeInteger(run.run_number) ||
      !Number.isSafeInteger(run.run_attempt) ||
      typeof run.event !== "string"
    )
      return {
        passed: false,
        reasons: [
          "GitHub returned inconsistent workflow details. Retry later or inspect the checks on GitHub.",
        ],
      };
    const key = JSON.stringify([
      check.app.id,
      run.workflow_id,
      run.event,
      check.name,
    ]);
    const previous = latest.get(key);
    if (
      !previous ||
      run.run_number > previous.run.run_number ||
      (run.run_number === previous.run.run_number &&
        run.run_attempt > previous.run.run_attempt) ||
      (run.run_number === previous.run.run_number &&
        run.run_attempt === previous.run.run_attempt &&
        check.id > previous.check.id)
    )
      latest.set(key, { check, run });
  }
  for (const check of [
    ...independent,
    ...[...latest.values()].map((item) => item.check),
  ]) {
    if (check.status !== "completed")
      reasons.push(
        `Check “${check.name}” is ${check.status}. Wait for it to finish, then retry.`,
      );
    else if (!["success", "neutral", "skipped"].includes(check.conclusion))
      reasons.push(
        `Check “${check.name}” finished with ${check.conclusion}. Open GitHub for its details.`,
      );
  }
  return { passed: reasons.length === 0, reasons };
}

async function snapshotFor(api, review) {
  const { pr, files } = review;
  const pageNumber = Math.max(1, Math.ceil(pr.comments / 100));
  let comments = await api(
    `/issues/${pr.number}/comments?per_page=100&page=${pageNumber}`,
  );
  if (comments.length < 10 && pageNumber > 1)
    comments = [
      ...(await api(
        `/issues/${pr.number}/comments?per_page=100&page=${pageNumber - 1}`,
      )),
      ...comments,
    ];
  return {
    description: pr.body ?? "",
    pr: {
      number: pr.number,
      title: pr.title,
      body: (pr.body ?? "").slice(0, 8000),
      user: { login: pr.user.login },
      head: { sha: pr.head.sha },
    },
    files: files.map(({ filename, status, text, previousText }) => ({
      filename,
      status,
      text,
      previousText,
    })),
    comments: comments
      .filter((comment) => comment.user.type !== "Bot")
      .slice(-10)
      .map((comment) => ({
        user: { login: comment.user.login },
        body: comment.body.slice(0, 2000),
      })),
  };
}

async function notify(request, env) {
  const payload = await boundedText(request, 4096);
  const timestamp = request.headers.get("X-Review-Timestamp");
  if (
    !/^\d{10}$/.test(timestamp ?? "") ||
    Math.abs(now() - Number(timestamp)) > 300 ||
    !(await verify(
      env.REVIEW_WEBHOOK_SECRET,
      `${timestamp}.${payload}`,
      request.headers.get("X-Review-Signature"),
    ))
  )
    return problem("Unauthorized.", 401);
  const input = JSON.parse(payload);
  if (
    input.repository !== env.GITHUB_REPOSITORY ||
    !Number.isSafeInteger(input.number) ||
    input.number < 1 ||
    !/^[a-f\d]{40}$/.test(input.head ?? "") ||
    !/^[a-f\d]{40}$/.test(input.base ?? "")
  )
    return problem("Invalid notification.", 400);
  if (
    !env.REVIEW_EMAIL ||
    !env.EMAIL_FROM ||
    !env.EMAIL?.send ||
    !env.PUBLIC_URL?.startsWith("https://")
  )
    return problem("Email delivery is not configured.", 503);
  const api = await appClient(env);
  const review = await collectReview(api, input.number);
  if (
    !review.passed ||
    review.pr.head.sha !== input.head ||
    review.pr.base.sha !== input.base
  )
    return problem("Submission no longer passes the review.");
  const snapshot = await snapshotFor(api, review);
  // Retried notifications for the same revision reuse the same review record.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO reviews (id, repository, pr_number, head, base, expires, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      env.GITHUB_REPOSITORY,
      input.number,
      input.head,
      input.base,
      now() + 86400,
      JSON.stringify(snapshot),
    )
    .run();
  let row = await env.DB.prepare(
    "SELECT * FROM reviews WHERE repository = ? AND pr_number = ? AND head = ? AND base = ?",
  )
    .bind(env.GITHUB_REPOSITORY, input.number, input.head, input.base)
    .first();
  // Description-only fixes do not change the commit SHA. Reopen the review
  // with a new token when the applicant edits it, including after feedback.
  // Never recycle a processing/error record: its GitHub writes are uncertain.
  if (
    ["pending", "declined"].includes(row.state) &&
    (descriptionChanged(review.pr, JSON.parse(row.snapshot)) ||
      (row.state === "pending" && row.expires <= now()))
  ) {
    await env.DB.prepare(
      "UPDATE reviews SET id = ?, expires = ?, email_sent = 0, snapshot = ?, state = 'pending' WHERE id = ? AND state = ? AND snapshot = ?",
    )
      .bind(
        crypto.randomUUID(),
        now() + 86400,
        JSON.stringify(snapshot),
        row.id,
        row.state,
        row.snapshot,
      )
      .run();
    row = await env.DB.prepare(
      "SELECT * FROM reviews WHERE repository = ? AND pr_number = ? AND head = ? AND base = ?",
    )
      .bind(env.GITHUB_REPOSITORY, input.number, input.head, input.base)
      .first();
  }
  if (row.email_sent === 1 || row.state !== "pending")
    return Response.json({ accepted: true, duplicate: true });
  // Reserve the send before contacting the provider. An uncertain result is
  // never retried automatically because the binding has no idempotency key.
  const sendLock = await env.DB.prepare(
    "UPDATE reviews SET email_sent = 2 WHERE id = ? AND email_sent = 0 AND state = 'pending'",
  )
    .bind(row.id)
    .run();
  if (sendLock.meta.changes !== 1)
    return problem(
      "Email sending is in progress or needs manual delivery verification.",
      503,
    );
  const emailedSnapshot = JSON.parse(row.snapshot);
  const token = await tokenFor(row, env.REVIEW_LINK_SECRET);
  const link = new URL("/review", env.PUBLIC_URL);
  link.searchParams.set("token", token);
  const decline = `${link}#decline`;
  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: env.REVIEW_EMAIL,
      subject: `moe.page: review PR #${row.pr_number} by ${emailedSnapshot.pr.user.login}`,
      text: `${detailsText(emailedSnapshot)}\n\nReview and approve: ${link}\nRequest changes: ${decline}\nGitHub: ${prUrl(env, row.pr_number)}\n\nLinks expire in 24 hours. Opening a link does not perform an action. Keep the links private. Website content still needs your review.`,
      html: `<h1>Submission ready for your review</h1><p>Format checks passed. Website content still needs your review.</p>${details(emailedSnapshot)}<p><a href="${escape(link)}">Review &amp; approve</a></p><p><a href="${escape(decline)}">Request changes</a></p><p><a href="${escape(prUrl(env, row.pr_number))}">View PR on GitHub</a></p><p>Links expire in 24 hours. Opening a link does not perform an action. Keep the links private.</p>`,
    });
  } catch {
    await env.DB.prepare("UPDATE reviews SET email_sent = -1 WHERE id = ?")
      .bind(row.id)
      .run();
    console.error(
      JSON.stringify({
        event: "review_email_needs_recovery",
        pr: row.pr_number,
      }),
    );
    return problem(
      "Email delivery could not be confirmed. Check the provider delivery log before manually retrying.",
      502,
    );
  }
  await env.DB.prepare("UPDATE reviews SET email_sent = 1 WHERE id = ?")
    .bind(row.id)
    .run();
  console.log(
    JSON.stringify({ event: "review_email_sent", pr: row.pr_number }),
  );
  return Response.json({ accepted: true });
}

async function lookup(env, token) {
  const parsed = await parseToken(token, env.REVIEW_LINK_SECRET);
  if (!parsed) return null;
  const row = await env.DB.prepare("SELECT * FROM reviews WHERE id = ?")
    .bind(parsed.id)
    .first();
  return row &&
    row.expires === parsed.expires &&
    row.repository === env.GITHUB_REPOSITORY
    ? row
    : null;
}

async function decide(request, env) {
  if (!allowedFormOrigin(request, env.PUBLIC_URL))
    return problem("Cross-site requests are not allowed.", 403);
  if (
    !request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return problem("Use the review form.", 415);
  const form = new URLSearchParams(await boundedText(request, 8192));
  const row = await lookup(env, form.get("token"));
  if (!row || row.state !== "pending")
    return problem(
      "This link is expired, already used, or awaiting manual recovery.",
      410,
    );
  const action = form.get("action");
  if (!["approve", "decline"].includes(action))
    return problem("Invalid action.", 400);
  const declineBody = declineComment(
    form.get("reason"),
    form.get("message"),
    env.REVIEWER_LOGIN,
  );
  if (action === "decline" && !declineBody)
    return problem(
      "Choose or enter a decline message (1–1000 characters).",
      400,
    );
  const api = await appClient(env);
  try {
    await current(api, row);
  } catch (error) {
    return problem(error.message);
  }
  let commitMessage;
  if (action === "approve") {
    const review = await collectReview(api, row.pr_number);
    if (!review.passed)
      return problem(
        `Submission validation failed: ${review.errors.join("; ")}`,
      );
    if (review.pr.head.sha !== row.head || review.pr.base.sha !== row.base)
      return problem("The PR revision changed. Use the latest review email.");
    if (review.pr.mergeable === null)
      return problem(
        "GitHub is still calculating mergeability. Wait a moment, then retry using this email.",
      );
    if (review.pr.mergeable !== true)
      return problem(
        "This PR has merge conflicts. Resolve them on GitHub before approving.",
      );
    const readiness = await checkReadiness(api, row.head);
    if (!readiness.passed) return problem(readiness.reasons.join(" "));
    if ((env.MERGE_METHOD || "squash") === "squash" && env.REVIEWER_COAUTHOR)
      commitMessage = squashCommitMessage(
        review.commits,
        env.REVIEWER_LOGIN,
        env.REVIEWER_COAUTHOR,
      );
  }
  // A conditional D1 write serializes concurrent approve/decline requests.
  const lock = await env.DB.prepare(
    "UPDATE reviews SET state = 'processing' WHERE id = ? AND state = 'pending' AND expires > ?",
  )
    .bind(row.id, now())
    .run();
  if (lock.meta.changes !== 1)
    return problem("Another request already used this link.", 409);
  try {
    await current(api, row);
    if (action === "approve") {
      await api(`/pulls/${row.pr_number}/reviews`, {
        method: "POST",
        body: {
          commit_id: row.head,
          event: "APPROVE",
          body: approvalComment(env.REVIEWER_LOGIN),
        },
      });
      await current(api, row);
      const merged = await api(`/pulls/${row.pr_number}/merge`, {
        method: "PUT",
        body: {
          sha: row.head,
          merge_method: env.MERGE_METHOD || "squash",
          ...(commitMessage ? { commit_message: commitMessage } : {}),
        },
      });
      if (!merged.merged) throw new Error("GitHub did not merge the PR.");
    } else {
      // A review pins the decline explanation to the revision that was actually read.
      await api(`/pulls/${row.pr_number}/reviews`, {
        method: "POST",
        body: {
          commit_id: row.head,
          event: "REQUEST_CHANGES",
          body: declineBody,
        },
      });
    }
    await env.DB.prepare("UPDATE reviews SET state = ? WHERE id = ?")
      .bind(action === "approve" ? "merged" : "declined", row.id)
      .run();
    console.log(
      JSON.stringify({
        event: action === "approve" ? "pr_merged" : "pr_changes_requested",
        pr: row.pr_number,
      }),
    );
    return page(
      action === "approve" ? "Approved & merged" : "Changes requested",
      `<p>${action === "approve" ? "GitHub merged this submission. The repository’s DNS deployment will run next; check GitHub for its result." : "Your feedback was posted as a review. The PR remains open so the applicant can update the same submission."}</p><p><a href="${escape(prUrl(env, row.pr_number))}">View PR on GitHub</a></p>`,
    );
  } catch {
    // Never automatically retry a partially completed GitHub write.
    await env.DB.prepare("UPDATE reviews SET state = 'error' WHERE id = ?")
      .bind(row.id)
      .run();
    console.error(
      JSON.stringify({
        event: "decision_needs_manual_recovery",
        pr: row.pr_number,
      }),
    );
    return page(
      "Check GitHub",
      `<p>The operation did not finish cleanly. Some steps may have succeeded. This link is disabled to prevent duplicate actions; finish the review on GitHub.</p><p><a href="${escape(prUrl(env, row.pr_number))}">Open PR</a></p>`,
      502,
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/notify")
        return await notify(request, env);
      if (request.method === "POST" && url.pathname === "/decision")
        return await decide(request, env);
      if (request.method === "GET" && url.pathname === "/review") {
        const token = url.searchParams.get("token");
        const row = await lookup(env, token);
        if (!row || row.state !== "pending")
          return problem(
            "This link is expired or already used. Request a fresh email or open GitHub.",
            410,
          );
        try {
          await current(await appClient(env), row);
        } catch (error) {
          return problem(error.message);
        }
        return reviewPage(
          JSON.parse(row.snapshot),
          token,
          prUrl(env, row.pr_number),
        );
      }
      return problem("Not found.", 404);
    } catch {
      console.error(
        JSON.stringify({ event: "review_request_failed", path: url.pathname }),
      );
      return problem(
        "The review service could not complete the request. Check the service configuration or use GitHub.",
        500,
      );
    }
  },
};
