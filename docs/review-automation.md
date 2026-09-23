# PR review and email approval setup

The GitHub workflow validates submissions and updates a bot comment. Passing submissions can be emailed to one configured maintainer with the applicant's username, PR description, recent discussion, domains, contact email, DNS records, proxy setting, and TTL. The email includes a review link and a decline link. Both open the same compact page; decline scrolls to its message form. No action occurs on GET, HEAD, email preview, or link scanning. HTML and plain-text emails are provided. The page requires no JavaScript and supports preset reasons as well as custom text for watch use.

Apple Watch Mail web views vary by watchOS version, mail client, and settings. The layout and form are designed for a small screen, but confirm both actions on your own watch before relying on it. GitHub links remain available as a fallback.

## Components

- `.github/workflows/review-submission.yml`: privileged `pull_request_target` workflow; executes only the trusted base revision. Applicant files are retrieved as bounded data through GitHub's API, never executed or installed. No PR checkout, artifact execution, or shell interpolation of applicant content.
- `scripts/validate-submission.js`: shared format and ownership checks, used in GitHub Actions and again by the service before merging.
- `review-service/`: Cloudflare Worker, D1 database, and Resend email integration. Approval links contain signed, expiring bearer tokens. They grant authority over one PR revision; keep them private.
- `.github/workflows/test.yml`: unprivileged tests for the validator and the Worker.

The service is intentionally a separate deployment. Merging these files activates comments and checks; email is skipped with a workflow warning until configured. Do not publish your recipient address or credentials in this public repository.

## Provision the review service

Use a Cloudflare account you administer and a verified sender in Resend. These are setup choices; this change does not provision a paid plan, add credentials, or deploy a service automatically.

```sh
cd review-service
npm ci
npx wrangler login
npx wrangler d1 create moe-page-review
```

Replace the placeholder `database_id` in `wrangler.jsonc` with the returned database ID. Keep `database_name`, the Worker name, and `GITHUB_REPOSITORY` aligned with your intended account and repo. Use local or staging resources first.

```sh
npx wrangler d1 migrations apply moe-page-review --remote
```

Set the following Worker secrets using `npx wrangler secret put NAME`. Do not put values in shell command arguments or in the repository.

| Secret | Value |
| --- | --- |
| `GITHUB_TOKEN` | Fine-grained service-account PAT restricted to this repository, with **Contents: read/write**, **Pull requests: read/write**, **Commit statuses: read**, and **Checks: read**. Metadata access is implicit. |
| `REVIEW_WEBHOOK_SECRET` | A cryptographically random secret of at least 32 characters, shared only with GitHub Actions. |
| `REVIEW_LINK_SECRET` | A separate random secret of at least 32 characters; only the Worker needs this. Rotating it invalidates all existing links. |
| `RESEND_API_KEY` | Resend key with email sending access for the verified sender. |
| `REVIEW_EMAIL` | The maintainer's destination email address. |
| `EMAIL_FROM` | Verified sender, e.g. `moe.page reviews <reviews@your-domain.example>`. |
| `PUBLIC_URL` | Canonical HTTPS origin of this Worker, without a path. |

Use a dedicated service account with write access, **without administrator/ruleset bypass privileges**. Its reviews and merges are attributed to that account; review text records that the decision came from the maintainer's private email page. The service account cannot approve its own PRs. Do not use `GITHUB_TOKEN` from a workflow as the Worker's credential: it expires, and merges using it generally do not trigger the existing push-based DNS deployment. A PAT or a separately implemented GitHub App installation token allows the deployment event to fire. The current implementation accepts a PAT; GitHub App token refresh is not implemented.

The service calls GitHub's normal merge API with the exact checked head SHA. It does not bypass protection rules, required reviews, or merge queues. All visible commit statuses must be successful and check runs must be complete and successful/neutral/skipped. If GitHub still requires additional reviews, the merge will fail and need completion on GitHub. Use GitHub directly for merge-queue-only repositories. `MERGE_METHOD` defaults to `squash` and can be changed to another method enabled in the repository.

```sh
npm test
npm run check
npm run deploy
```

D1 and the GitHub token remain server-side. The database stores submission snapshots, token identifiers, expiry, and decision states, not raw link signatures. No applicant email is used as the notification destination. Invocation logging is disabled and trace sampling is zero because review URLs contain credentials; structured application logs include only event names and PR numbers. Do not enable raw URL logging or attach third-party analytics to the review pages.

## Connect GitHub Actions

In **Repository Settings → Secrets and variables → Actions**:

1. Add repository variable `REVIEW_SERVICE_URL` with the deployed HTTPS origin.
2. Add repository secret `REVIEW_WEBHOOK_SECRET` with the same value as the Worker's webhook secret.
3. Ensure GitHub Actions is enabled and organization settings allow the workflow's scoped permissions: contents read, pull requests write, and commit statuses write. The workflow does not submit approval reviews itself.
4. Merge the reviewed implementation into `main` to activate the trusted-base workflow.

New/opened/updated/reopened PRs and PR description/draft-status edits are checked. Existing PRs are not retroactively emailed just by merging the workflow. Run **Review Subdomain Submission → Run workflow**, enter a PR number, or push a new commit to that PR. Workflow dispatch should run from `main`.

A PR's exact head and base commits are fixed in each link. Changes to the PR or `main` invalidate old links. When `main` advances, manually rerun the review workflow for pending submissions to get fresh emails. Duplicate workflow runs reuse the same email and links for 24 hours; rerunning after expiry issues a new link. Discussion and description in the email/page are the snapshot at the time of the first notification; open GitHub for newer conversation. Descriptions are capped at 8,000 characters and the latest 10 discussion comments at 2,000 characters each. Code-review inline comments are available through the GitHub link.

## Decisions and recovery

- **Approve & merge** rechecks the submission, open/draft state, head/base commits, mergeability, commit statuses, and check runs. It acquires a single-use D1 lock, submits an approval review pinned to the head commit, rechecks the PR, then merges that SHA. DNS deployment runs separately afterward.
- **Decline & close PR** requires a preset or custom message. It locks the link, posts a request-changes review pinned to the checked commit, checks the revision again, and closes the PR. The message is visible in the PR conversation.
- Changes during validation abort the operation. Concurrent or repeated taps cannot acquire the same D1 lock twice. The merge API also atomically rejects a different head SHA. GitHub's close API has no conditional head parameter: there is a small unavoidable race after the final check when closing, so reopen on GitHub if someone pushed at that exact moment. Likewise, the base branch can move between the final read and merge; GitHub's protections are the final gate.
- If a GitHub write partly succeeds, or a request times out after locking, the link remains `error` or `processing`. It is not automatically retried. Inspect the PR on GitHub and complete the action there. Do not reset a lock until you have established what happened.
- Email provider failures surface in the workflow; fix the sender/API key and rerun. Resend idempotency keys prevent duplicate sends during retries. Successful API acceptance does not guarantee inbox delivery; check the provider delivery log.
- The database has no automated purge. Periodically remove expired completed records according to your retention needs; keep uncertain `processing`/`error` records until resolved.

## Verification before enabling live decisions

`npm test` at the repository root covers format, DNS, ownership, scope, and unsafe git object handling. `cd review-service && npm test` runs integration tests in Cloudflare's Workers runtime with a real local D1 binding and mocked GitHub/email APIs. `npm run check` bundles the Worker without deployment.

For a live staging check, use a test repository and a service credential limited to it. Confirm email delivery and both watch forms there, including a changed-commit rejection and a second tap. Do not test merging or declining on an applicant's real PR. Production mail delivery, credentials, branch protection, DNS deployment, and Apple Watch interaction cannot be verified by the mocked tests.
