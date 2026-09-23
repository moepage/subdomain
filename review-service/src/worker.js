import { collectReview, githubClient } from "../../scripts/github.js";
import { boundedText, parseToken, tokenFor, verify } from "./security.js";
import { details, detailsText, escape, page, reviewPage } from "./views.js";

const now = () => Math.floor(Date.now() / 1000);
const prUrl = (env, number) =>
  `https://github.com/${env.GITHUB_REPOSITORY}/pull/${number}`;
const apiFor = (env) => githubClient(env.GITHUB_TOKEN, env.GITHUB_REPOSITORY);
const problem = (message, status = 409) =>
  page("Review unavailable", `<p>${escape(message)}</p>`, status);

async function current(api, row) {
  const pr = await api(`/pulls/${row.pr_number}`);
  if (
    pr.state !== "open" ||
    pr.draft ||
    pr.head.sha !== row.head ||
    pr.base.sha !== row.base ||
    pr.base.ref !== "main"
  )
    throw new Error(
      "The PR is closed, draft, or has changed. Use a fresh review email.",
    );
  return pr;
}

export async function checksPassed(api, head) {
  const [status, checks] = await Promise.all([
    api(`/commits/${head}/status?per_page=100`),
    api(`/commits/${head}/check-runs?per_page=100&filter=latest`),
  ]);
  return (
    status.state === "success" &&
    status.statuses.some(
      (item) =>
        item.context === "submission-format" && item.state === "success",
    ) &&
    checks.total_count <= 100 &&
    checks.check_runs.every(
      (check) =>
        check.status === "completed" &&
        ["success", "neutral", "skipped"].includes(check.conclusion),
    )
  );
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
    !env.RESEND_API_KEY ||
    !env.PUBLIC_URL?.startsWith("https://")
  )
    return problem("Email delivery is not configured.", 503);
  const api = apiFor(env);
  const review = await collectReview(api, input.number);
  if (
    !review.passed ||
    review.pr.head.sha !== input.head ||
    review.pr.base.sha !== input.base
  )
    return problem("Submission no longer passes the review.");
  // Retried notifications for the same revision reuse the same links and email idempotency key.
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
      JSON.stringify(await snapshotFor(api, review)),
    )
    .run();
  let row = await env.DB.prepare(
    "SELECT * FROM reviews WHERE repository = ? AND pr_number = ? AND head = ? AND base = ?",
  )
    .bind(env.GITHUB_REPOSITORY, input.number, input.head, input.base)
    .first();
  // An explicit workflow rerun after expiry issues a new token and email.
  if (row.expires <= now() && row.state === "pending") {
    await env.DB.prepare(
      "UPDATE reviews SET id = ?, expires = ?, email_sent = 0, snapshot = ? WHERE id = ? AND state = ? AND expires <= ?",
    )
      .bind(
        crypto.randomUUID(),
        now() + 86400,
        JSON.stringify(await snapshotFor(api, review)),
        row.id,
        "pending",
        now(),
      )
      .run();
    row = await env.DB.prepare(
      "SELECT * FROM reviews WHERE repository = ? AND pr_number = ? AND head = ? AND base = ?",
    )
      .bind(env.GITHUB_REPOSITORY, input.number, input.head, input.base)
      .first();
  }
  if (row.email_sent || row.state !== "pending")
    return Response.json({ accepted: true, duplicate: true });
  const snapshot = JSON.parse(row.snapshot);
  const token = await tokenFor(row, env.REVIEW_LINK_SECRET);
  const link = new URL("/review", env.PUBLIC_URL);
  link.searchParams.set("token", token);
  const decline = `${link}#decline`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `moe-review-${row.id}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [env.REVIEW_EMAIL],
      subject: `moe.page: review PR #${row.pr_number} by ${snapshot.pr.user.login}`,
      text: `${detailsText(snapshot)}\n\nReview and approve: ${link}\nDecline with a message: ${decline}\nGitHub: ${prUrl(env, row.pr_number)}\n\nLinks expire in 24 hours. Opening a link does not perform an action. Keep the links private. Website content still needs your review.`,
      html: `<h1>Submission ready for your review</h1><p>Format checks passed. Website content still needs your review.</p>${details(snapshot)}<p><a href="${escape(link)}">Review &amp; approve</a></p><p><a href="${escape(decline)}">Decline with a message</a></p><p><a href="${escape(prUrl(env, row.pr_number))}">View PR on GitHub</a></p><p>Links expire in 24 hours. Opening a link does not perform an action. Keep the links private.</p>`,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    return problem(
      "Email provider rejected the notification; rerun after checking the sender configuration.",
      502,
    );
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
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    (origin && origin !== new URL(env.PUBLIC_URL).origin) ||
    fetchSite === "cross-site"
  )
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
  const custom = form.get("message")?.trim();
  const reason = custom || form.get("reason")?.trim();
  if (
    action === "decline" &&
    (!reason || reason === "custom" || reason.length > 1000)
  )
    return problem(
      "Choose or enter a decline message (1–1000 characters).",
      400,
    );
  const api = apiFor(env);
  try {
    await current(api, row);
  } catch (error) {
    return problem(error.message);
  }
  if (action === "approve") {
    const review = await collectReview(api, row.pr_number);
    if (
      !review.passed ||
      review.pr.head.sha !== row.head ||
      review.pr.base.sha !== row.base ||
      review.pr.mergeable !== true ||
      !(await checksPassed(api, row.head))
    )
      return problem(
        "Checks, branch rules, or mergeability are not ready. Retry later or open GitHub.",
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
          body: "Approved by the maintainer through the private email review page.",
        },
      });
      await current(api, row);
      const merged = await api(`/pulls/${row.pr_number}/merge`, {
        method: "PUT",
        body: { sha: row.head, merge_method: env.MERGE_METHOD || "squash" },
      });
      if (!merged.merged) throw new Error("GitHub did not merge the PR.");
    } else {
      // A review pins the decline explanation to the revision that was actually read.
      await api(`/pulls/${row.pr_number}/reviews`, {
        method: "POST",
        body: {
          commit_id: row.head,
          event: "REQUEST_CHANGES",
          body: `Declined by the maintainer through the private email review page.\n\n${reason}`,
        },
      });
      await current(api, row);
      await api(`/pulls/${row.pr_number}`, {
        method: "PATCH",
        body: { state: "closed" },
      });
    }
    await env.DB.prepare("UPDATE reviews SET state = ? WHERE id = ?")
      .bind(action === "approve" ? "merged" : "declined", row.id)
      .run();
    console.log(
      JSON.stringify({
        event: action === "approve" ? "pr_merged" : "pr_declined",
        pr: row.pr_number,
      }),
    );
    return page(
      action === "approve" ? "Approved & merged" : "Declined",
      `<p>${action === "approve" ? "GitHub merged this submission. The repository’s DNS deployment will run next; check GitHub for its result." : "Your message was posted as a review and the PR was closed."}</p><p><a href="${escape(prUrl(env, row.pr_number))}">View PR on GitHub</a></p>`,
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
          await current(apiFor(env), row);
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
