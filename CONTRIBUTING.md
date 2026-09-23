# Submission rules / 提交规范

For a normal subdomain request, submit a PR to `main` with a short description of your website. The automated reviewer comments on every submission and reports the `submission-format` status. Passing format checks does not approve the website's content.

普通域名申请请向 `main` 提交 PR，并简要说明网站用途。机器人会检查格式并留言；检查通过不代表内容审核通过。

## Files and JSON

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

Every non-merge commit must use one of these forms (first line at most 120 characters):

```text
add(luna): add my personal blog
update(luna): enable Cloudflare proxy
fix(luna): correct the CNAME target
Create luna.json
Update luna.json
Add luna.json for DNS record configuration
```

The verbs `add`, `update`, and `fix` and GitHub-style `Create`, `Update`, `Add`, and `Fix` are accepted case-insensitively. In the first form, use the domain inside parentheses and a meaningful description after `: `. In the GitHub-style form, use the JSON filename. GitHub-generated merge/sync commits are exempt. PRs with more than 100 commits need manual review.

每个非合并提交均需使用上述格式，首行不超过 120 字符。支持 GitHub 网页编辑器默认生成的 `Create xxx.json` 和 `Update xxx.json`。

## Review results

Fix the errors in the bot's comment and push again. Draft PRs are not emailed. A passing submission gets a maintainer review; it is never automatically merged just because the check passes.

For maintenance PRs, the format check deliberately fails with an explanation. A maintainer can review and merge them manually. **Do not make `submission-format` universally required** unless your branch rules provide a deliberate maintenance path.
