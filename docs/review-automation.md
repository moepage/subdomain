# PR review and email approval setup

The GitHub workflow validates submissions and updates a bot comment. Passing submissions can be emailed to one configured maintainer with the applicant's username, PR description, recent discussion, domains, contact email, DNS records, proxy setting, and TTL. The email includes a review link and a decline link. Both open the same compact page; decline scrolls to its message form. No action occurs on GET, HEAD, email preview, or link scanning. HTML and plain-text emails are provided. The dark page requires no JavaScript and supports preset reasons as well as custom text for watch use.

Apple Watch Mail web views vary by watchOS version, mail client, and settings. The layout and form are designed for a small screen, but confirm both actions on your own watch before relying on it. GitHub links remain available as a fallback.

## Components

- `.github/workflows/review-submission.yml`: privileged `pull_request_target` workflow; executes only the trusted base revision. Applicant files are retrieved as bounded data through GitHub's API, never executed or installed. No PR checkout, artifact execution, or shell interpolation of applicant content.
- `scripts/validate-submission.js`: shared format and ownership checks, used in GitHub Actions and again by the service before merging.
- `review-service/`: Cloudflare Worker, D1 database, and native Cloudflare email integration. Approval links contain signed, expiring bearer tokens. They grant authority over one PR revision; keep them private.
- `.github/workflows/test.yml`: unprivileged tests for the validator and the Worker.

The service is intentionally a separate deployment. Merging these files activates comments and checks; email is skipped with a workflow warning until configured. Do not publish your recipient address or credentials in this public repository.

## Provision the review service

Use a Cloudflare account you administer, an Email Routing sender domain, and a verified destination address. Sending to verified destinations is supported on the free plan; this service does not need arbitrary-recipient sending or Resend. These are setup choices; this change does not provision a paid plan, add credentials, or deploy a service automatically.

```sh
cd review-service
npm ci
npx wrangler login
npx wrangler d1 create moe-page-review
```

The checked-in configuration identifies the production account and D1 database. For a different deployment, replace `account_id` and `database_id` with your own identifiers. Keep `database_name`, the Worker name, and `GITHUB_REPOSITORY` aligned with your intended account and repo. Use local or staging resources first.

```sh
npx wrangler d1 migrations apply moe-page-review --remote
```

Set the following Worker secrets using `npx wrangler secret put NAME`. Do not put values in shell command arguments or in the repository.

| Secret                       | Value                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_ID`              | Numeric ID of the organization-owned GitHub App.                                                                            |
| `GITHUB_APP_INSTALLATION_ID` | Numeric installation ID for this repository.                                                                                |
| `GITHUB_APP_PRIVATE_KEY`     | The App’s PEM private key. Upload from a protected local file/stdin; both GitHub PKCS#1 and PKCS#8 are supported.           |
| `REVIEW_WEBHOOK_SECRET`      | A cryptographically random secret of at least 32 characters, shared only with GitHub Actions.                               |
| `REVIEW_LINK_SECRET`         | A separate random secret of at least 32 characters; only the Worker needs this. Rotating it invalidates all existing links. |
| `REVIEW_EMAIL`               | The maintainer's destination email address.                                                                                 |
| `EMAIL_FROM`                 | Plain sender address on the configured domain, e.g. `reviews@your-domain.example`.                                          |
| `PUBLIC_URL`                 | Canonical HTTPS origin of this Worker, without a path.                                                                      |

Create a private GitHub App owned by the repository's organization. Disable webhooks and user OAuth authorization. Grant repository **Contents: read/write**, **Pull requests: read/write**, **Commit statuses: read**, and **Checks: read**; Metadata read access is implicit. Leave other permissions unset. Install it on **only this repository**, with no administrator/ruleset bypass privileges. Contents write is required by GitHub's merge API and also technically allows other content writes; GitHub has no merge-only permission.

The Worker signs a short-lived App JWT and requests a one-hour installation token restricted to the configured repository and permissions for each request. App reviews and merges are attributed to its bot (`moepage-review[bot]` for this deployment). `REVIEWER_LOGIN` credits the human reviewer with a mention in approval/decline messages; the automated format comment identifies that account as the human-review contact without claiming approval. For squash merges, optional `REVIEWER_COAUTHOR` adds the configured Git identity as a `Co-authored-by` trailer, preserving commit authors and existing co-author trailers. This does not make the human account the GitHub API actor. Unlike the Actions workflow's built-in `GITHUB_TOKEN`, App installation-token merges can trigger the existing push-based DNS deployment. No personal access token or user OAuth client secret is required.

Configure `send_email` with a binding named `EMAIL` and a sender allowlist matching `EMAIL_FROM`. Without a destination restriction, Cloudflare limits the binding to verified account destinations; the application sends only to the private `REVIEW_EMAIL` setting, never an applicant address. For tighter binding-level controls, use a private deployment config with `destination_address` set to the maintainer. Enable Email Routing for the sender's subdomain and verify the destination first. See [Cloudflare sending bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/) and [pricing](https://developers.cloudflare.com/email-service/platform/pricing/). Do not upgrade plans for this setup without approval.

The service calls GitHub's normal merge API with the exact checked head SHA. It does not bypass protection rules, required reviews, or merge queues. All visible commit statuses must be successful and check runs must be complete and successful/neutral/skipped. If GitHub still requires additional reviews, the merge will fail and need completion on GitHub. Use GitHub directly for merge-queue-only repositories. `MERGE_METHOD` defaults to `squash` and can be changed to another method enabled in the repository. Co-author credit is only added for squash merges; rebase merges preserve their original commits. The configured reviewer uses their GitHub no-reply address, not a personal mailbox.

```sh
npm test
npm run check
npm run deploy
```

D1, the App key, and installation tokens remain server-side. The database stores submission snapshots, token identifiers, expiry, and decision states, not raw link signatures. No applicant email is used as the notification destination. Invocation logging is disabled and trace sampling is zero because review URLs contain credentials; structured application logs include only event names and PR numbers. Do not enable raw URL logging or attach third-party analytics to the review pages.

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
- **Request changes** requires a preset or custom message. It locks the link, posts a polite request-changes review pinned to the checked commit, and keeps the PR open. The review pairs English and Chinese lines for the greeting, preset reason, and closing, includes any additional note exactly as written, and explains how to edit the description or push fixes to the same PR branch. Presets include missing website details, domain/DNS issues, project-rule issues, and inappropriate content. The message is visible in the PR conversation.
- Changes during validation abort the operation. Concurrent or repeated taps cannot acquire the same D1 lock twice. The merge API also atomically rejects a different head SHA. Likewise, the base branch can move between the final read and merge; GitHub's protections are the final gate.
- If a GitHub write partly succeeds, or a request times out after locking, the link remains `error` or `processing`. It is not automatically retried. Inspect the PR on GitHub and complete the action there. Do not reset a lock until you have established what happened.
- Email sends acquire a separate D1 lock. `email_sent` is `0` (not attempted), `2` (sending), `1` (accepted), or `-1` (uncertain failure). The Cloudflare binding provides no idempotency key, so an uncertain send is not automatically retried. Inspect Cloudflare delivery logs; only after establishing non-delivery should an operator reset that row to `0` and rerun the workflow. Successful API acceptance does not guarantee inbox delivery. An explicit rerun after the 24-hour link expiry issues a new review and email.
- The database has no automated purge. Periodically remove expired completed records according to your retention needs; keep uncertain `processing`/`error` records until resolved.

## Verification before enabling live decisions

`npm test` at the repository root covers format, DNS, ownership, scope, and unsafe git object handling. `cd review-service && npm test` runs integration tests in Cloudflare's Workers runtime with a real local D1 binding and mocked GitHub/email APIs. `npm run check` bundles the Worker without deployment.

For a live staging check, use a test repository and a service credential limited to it. Confirm email delivery and both watch forms there, including a changed-commit rejection and a second tap. Do not test merging or declining on an applicant's real PR. Production mail delivery, credentials, branch protection, DNS deployment, and Apple Watch interaction cannot be verified by the mocked tests.

Description or title changes invalidate the old review link even when the commit SHA is unchanged. A signed notification after those edits rotates the D1 review ID and sends a fresh email, including after a request for changes. A new commit also creates a fresh review. Unchanged reruns do not resend decided reviews; processing/error records require manual recovery. The internal `declined` state now means feedback was submitted, not that the PR was closed.

The form uses a secret HMAC-signed bearer token, not cookie authentication. Explicit foreign origins are blocked; absent or `null` origins from privacy-preserving mail browsers are allowed only with the same valid, unused token. Fetch metadata alone cannot reject a valid Watch form. GET requests never decide a review.
