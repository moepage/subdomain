# Submission rules / 提交规范

For a normal subdomain request, submit a PR to `main` with a short description of your website. The automated reviewer comments on every submission and reports the `submission-format` status. Passing format checks does not approve the website's content.

普通域名申请请向 `main` 提交 PR，并简要说明网站用途。机器人会检查格式并留言；检查通过不代表内容审核通过。

## Quick start

Copy the README's JSON template, replace the username/domain/DNS target, save it as `records/<domain>.json`, and open a PR describing your website in one sentence. The contact email is optional. Keep `proxied` as `false` if you are unsure. The bot will explain any problem and you can edit the same PR to fix it.

复制 README 模板，填写用户名、域名和 DNS 目标，保存为 `records/<域名>.json`，再提交 PR 并用一句话介绍网站即可。邮箱可不填；不确定代理设置时保留 `false`。机器人会提示问题，修改同一个 PR 即可。

## Detailed checks (reference)

- Change 1–10 files, only directly under `records/`, named `<domain>.json`. Automated approval accepts additions and modifications; deletions, renames, and maintenance changes require manual review.
- Each file must be a regular, non-executable UTF-8 JSON object, at most 32 KiB.
- Required fields: `owner`, `domain`, `records`, `proxied`. Optional field: `ttl`. Other fields are rejected to catch typos.
- `owner` contains a valid `username` and optionally `email`. The username must match the PR author, case-insensitively. Email may be omitted or empty; supplied addresses are public.
- `domain` must equal the filename without `.json`. Use lowercase DNS labels separated by dots, each no longer than 63 characters. A leading underscore supports verification labels. No wildcards, slashes, URLs, or trailing dot.
- `records` supports `A`, `AAAA`, `CNAME`, and `TXT`. Each value is a string or an array of 1–20 unique, non-empty strings. A/AAAA must be valid IP addresses. TXT values are at most 2,048 UTF-8 bytes each.
- `CNAME` takes exactly one hostname, without a URL, IP address, or self-reference. It cannot coexist with any other record type.
- `proxied` must be `true` or `false`. Set it to `false` for TXT-only configurations.
- Optional `ttl`: `1` (automatic) or an integer from `60` to `86400` seconds.
- Existing files, parent namespaces, and child namespaces remain reserved for their recorded owners. Delegated requests and ownership transfers need manual review.
- The current deployment script does not remove old record types or non-CNAME values. Such changes must be handled manually, including the DNS cleanup.

完整示例见 [中文说明](README.md) 或 [English README](README.en.md)。机器人只检查 PR 中变更的配置，不要求一次修复所有旧文件。

## Commit messages

Use a short, readable commit message. **GitHub's default message is fine; no special syntax is required.** For example:

```text
Create luna.json
Update luna.json
Add my personal blog
修正博客的 DNS 记录
```

The automated check only requires a non-empty first line of at most 200 characters, without control characters. Merge/sync commits are exempt. PRs with more than 100 commits need manual review.

**不需要学习特殊的提交格式，直接保留 GitHub 默认的提交说明即可。** 也可以用中文或其他语言简要说明变更。首行非空、不超过 200 字符，且不含控制字符即可。

## Review results

Fix the errors in the bot's comment and push again. Draft PRs are not emailed. A passing submission gets a maintainer review; it is never automatically merged just because the check passes.

For maintenance PRs, the format check deliberately fails with an explanation. A maintainer can review and merge them manually. **Do not make `submission-format` universally required** unless your branch rules provide a deliberate maintenance path.

## Fixing a failed check / 修复检查失败

If the bot asks for a website description, edit the first message at the top of your PR: **⋯ → Edit → Update comment**. Explain what your website is for and include its current link if available. Saving reruns the check automatically.
如果机器人要求补充网站说明，请编辑 PR 顶部的第一条消息：**⋯ → Edit（编辑）→ Update comment（更新评论）**。说明网站用途，如已有网站请附上链接。保存后检查会自动重跑。

A separate comment does not replace the PR description or trigger a check. For JSON/file errors, commit fixes to the same PR branch. Keep the PR open; a new PR is unnecessary.
另发评论不能替代 PR 描述，也不会触发检查。JSON 或文件问题请在同一 PR 分支上提交修改。请保留此 PR，无需新建。

If manual review is required or you need help, comment in the PR to explain the situation. A maintainer can assist or rerun the check.
如果需要人工审核或帮助，请在 PR 下留言说明情况，由管理员协助处理或重跑检查。

## Addressing maintainer feedback / 处理人工审核反馈

If a maintainer requests changes, this PR stays open. Edit its description or push fixes to the same branch, following the feedback. Passing checks sends the updated submission back for review. If you fixed the website itself, update the description to explain the fix. You do not need a new PR.
如果管理员要求修改，此 PR 会保持开放。请根据反馈修改描述，或将修复提交到同一分支；检查通过后，更新后的申请会再次进入人工审核。如果修改的是网站本身，请更新描述说明修复内容，无需新建 PR。
