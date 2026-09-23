export const marker = "<!-- moe-page-submission-review -->";
const descriptionError =
  "Describe the purpose of your website in the PR description.";
const translations = new Map([
  [descriptionError, "请在 PR 描述中说明网站的用途。"],
  ["File exceeds 32 KiB.", "文件大小超过 32 KiB，请缩小文件。"],
  ["Invalid JSON.", "JSON 格式无效，请检查逗号、引号和括号。"],
  ["The JSON root must be an object.", "JSON 最外层必须是对象（使用大括号）。"],
  [
    "Unknown top-level field; allowed: owner, domain, records, proxied, ttl.",
    "包含未知字段；最外层仅允许 owner、domain、records、proxied、ttl。",
  ],
  [
    "owner must contain a GitHub username and optional email only.",
    "owner 必须包含有效的 GitHub 用户名 username，可选填 email，不接受其他字段。",
  ],
  [
    "owner.email must be a valid email or an empty string.",
    "owner.email 必须是有效邮箱或空字符串，也可以省略该字段。",
  ],
  [
    "domain must be lowercase DNS labels and match records/<domain>.json exactly.",
    "domain 必须使用小写的有效 DNS 名称，并与 records/<domain>.json 文件名完全一致。",
  ],
  ["proxied must be true or false.", "proxied 必须为 true 或 false。"],
  [
    "ttl must be 1 (automatic), or an integer from 60 to 86400.",
    "ttl 必须为 1（自动），或 60 至 86400 之间的整数。",
  ],
  [
    "records must be a non-empty object.",
    "records 必须是包含至少一条 DNS 记录的对象。",
  ],
  [
    "CNAME cannot coexist with another record type.",
    "CNAME 不能与其他记录类型同时使用。",
  ],
  [
    "proxied is only available for A, AAAA, or CNAME.",
    "只有 A、AAAA 或 CNAME 记录可以开启 proxied。",
  ],
  ["CNAME must have exactly one target.", "CNAME 必须且只能填写一个目标。"],
  ["A values must be IPv4 addresses.", "A 记录的值必须是 IPv4 地址。"],
  ["AAAA values must be IPv6 addresses.", "AAAA 记录的值必须是 IPv6 地址。"],
  [
    "CNAME must be a hostname, without a URL, IP address, or self-reference.",
    "CNAME 必须填写目标主机名，不能填写完整网址、IP 地址或指向自身。",
  ],
  [
    "TXT values must be at most 2048 UTF-8 bytes.",
    "每个 TXT 值不能超过 2048 个 UTF-8 字节。",
  ],
  ["Submissions must target main.", "申请 PR 的目标分支必须是 main。"],
  [
    "Mark the PR ready for review before requesting email approval.",
    "请先将草稿 PR 标记为 Ready for review（准备好接受审核）。",
  ],
  [
    "A submission must change 1–10 record files.",
    "每次申请必须修改 1 至 10 个记录文件。",
  ],
  [
    "A submission must contain 1–100 commits.",
    "每次申请必须包含 1 至 100 个提交。",
  ],
  [
    "only added/modified records/*.json files qualify; maintenance, deletions, and renames need manual review.",
    "自动审核仅支持新增或修改 records/*.json；维护代码、删除或重命名文件需要人工审核。",
  ],
  [
    "owner.username must match the PR author; delegated submissions need manual review.",
    "owner.username 必须与 PR 提交者的 GitHub 用户名一致；代他人申请需要人工审核。",
  ],
  [
    "an existing record in this namespace belongs to another owner; manual review required.",
    "此域名范围内已有记录属于其他用户，需要人工审核。",
  ],
  [
    "existing invalid JSON requires manual repair.",
    "原有 JSON 文件格式无效，需要管理员修复。",
  ],
  [
    "changing an existing domain requires manual review.",
    "修改已有记录的域名需要人工审核。",
  ],
  [
    "removing/changing a DNS record type requires manual DNS cleanup.",
    "删除或更换 DNS 记录类型需要管理员手动清理旧记录。",
  ],
  ["PR is no longer open.", "此 PR 已关闭或合并。"],
  [
    "Too many changed files or commits; manual review required.",
    "修改的文件或提交数量过多，需要人工审核。",
  ],
  [
    "Incomplete GitHub data; retry or review manually.",
    "GitHub 返回的数据不完整，请管理员重跑检查或人工审核。",
  ],
  [
    "Incomplete head tree; manual review required.",
    "无法读取完整的提交文件列表，需要人工审核。",
  ],
  [
    "must be a regular non-executable file.",
    "必须使用普通文件，不能是可执行文件或符号链接。",
  ],
  [
    "Repository exceeds automatic namespace scan limit; manual review required.",
    "仓库记录数量超过自动扫描上限，需要人工审核。",
  ],
  [
    "PR changed during validation; rerun the review.",
    "PR 在检查期间发生了变化，请重新运行检查。",
  ],
  [
    "Record must be a regular JSON blob no larger than 32 KiB.",
    "记录必须是大小不超过 32 KiB 的普通 JSON 文件。",
  ],
  [
    "Record must be a UTF-8 JSON blob no larger than 32 KiB.",
    "记录必须是大小不超过 32 KiB 的 UTF-8 JSON 文件。",
  ],
  [
    "Record must be a regular UTF-8 JSON file no larger than 32 KiB.",
    "记录必须是大小不超过 32 KiB 的普通 UTF-8 JSON 文件。",
  ],
  [
    "GitHub could not read the complete record batch.",
    "无法从 GitHub 读取完整的记录数据。",
  ],
  ["Incomplete record data.", "记录数据不完整。"],
  [
    "Existing record is not a regular file; manual review required.",
    "已有记录不是普通文件，需要人工审核。",
  ],
]);

export function translateError(error) {
  if (translations.has(error)) return translations.get(error);
  let match;
  if (
    (match =
      /^Unsupported record type: (.*)\. Use A, AAAA, CNAME, or TXT\.$/s.exec(
        error,
      ))
  )
    return `不支持记录类型 ${match[1]}，请使用 A、AAAA、CNAME 或 TXT。`;
  if (
    (match = /^(.*) must contain 1–20 unique, non-empty strings\.$/s.exec(
      error,
    ))
  )
    return `${match[1]} 必须包含 1 至 20 个不重复的非空字符串。`;
  if (
    (match =
      /^Commit ([a-f\d]+): use a non-empty, readable first line up to 200 characters\. GitHub's default message is fine\.$/.exec(
        error,
      ))
  )
    return `提交 ${match[1]} 的说明首行必须非空、可读且不超过 200 字符。可以保留 GitHub 默认的提交说明。`;
  if (
    (match =
      /^removing\/replacing (.*) values requires manual DNS cleanup\.$/s.exec(
        error,
      ))
  )
    return `删除或替换 ${match[1]} 的值需要管理员手动清理旧 DNS 记录。`;
  if ((match = /^GitHub request failed \((\d+)\)\.$/.exec(error)))
    return `GitHub 请求失败（状态码 ${match[1]}），请联系管理员检查并重试。`;
  if (error.startsWith("Validation could not finish: "))
    return `未能完成检查：${translateError(error.slice(29))}`;
  const separator = error.indexOf(": ");
  if (separator !== -1)
    return `${error.slice(0, separator)}：${translateError(error.slice(separator + 2))}`;
  return "检查遇到异常，请联系管理员查看上方错误和工作流日志。";
}

const safe = (value) =>
  String(value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[&<>@`\[\]\\*_!|#]/g, (char) => `&#${char.charCodeAt(0)};`);
const pair = (en, zh) => `${en}  \n${zh}`;

export function submissionComment({
  pr,
  passed,
  errors = [],
  repository,
  runUrl,
  reviewer,
}) {
  const prUrl = `https://github.com/${repository}/pull/${pr.number}`;
  const content = [
    marker,
    passed
      ? pair("## ✅ Submission format passed", "## ✅ 申请格式检查通过")
      : pair(
          "## ❌ Submission needs attention",
          "## ❌ 申请需要修改或人工处理",
        ),
  ];
  if (passed)
    content.push(
      pair(
        "The automatic format checks passed. Please wait for a maintainer to review your website and decide; no new PR or comment is needed.",
        "自动格式检查已通过，请等待管理员审核网站并作出决定；无需重新提交 PR 或留言。",
      ),
    );
  else {
    content.push(
      errors
        .slice(0, 60)
        .map((error) => `- ${safe(error)}  \n  ${safe(translateError(error))}`)
        .join("\n"),
    );
    content.push(pair("### What to do next", "### 接下来怎么做"));
    if (errors.includes(descriptionError))
      content.push(
        [
          pair(
            `1. Open [this PR](${prUrl}) and find its **first message at the top** (the PR description).`,
            `   打开[此 PR](${prUrl})，找到**页面顶部的第一条消息**（PR 描述）。`,
          ),
          pair(
            "2. Click **⋯ → Edit**, describe what your website is for, and include its current link if you have one. Then click **Update comment** to save.",
            "   点击 **⋯ → Edit（编辑）**，说明网站用途；如果已有网站，也请附上链接。然后点击 **Update comment（更新评论）** 保存。",
          ),
          pair(
            "Example: “This is my personal blog about illustration and games. Website: https://example.com.” Replace this example with your own details.",
            "示例：“这是我的个人博客，主要分享插画和游戏。网站：https://example.com。”请替换为您自己的实际信息。",
          ),
          pair(
            "Saving the PR description automatically reruns this check. **A separate comment does not satisfy the description requirement or rerun the check.** Keep this PR open; you do not need a new one.",
            "保存 PR 描述后，检查会自动重跑。**另发一条评论不能替代 PR 描述，也不会触发检查。**请保留此 PR，无需重新申请。",
          ),
        ].join("\n\n"),
      );
    if (
      !errors.includes(descriptionError) ||
      errors.some((error) => error !== descriptionError)
    )
      content.push(
        pair(
          "For file or commit errors, fix them on the same branch used by this PR and commit/push the changes. The check will rerun automatically. Keep this PR open; you do not need a new one.",
          "如果是文件或提交问题，请在此 PR 对应的分支上修改并提交、推送，检查会自动重跑。请保留此 PR，无需重新申请。",
        ),
      );
    content.push(
      pair(
        "If an error requires manual review, or you need help, leave a comment in this PR explaining the situation. A maintainer can review it or rerun the check; commenting alone does not clear the failed check.",
        "如果错误提示需要人工审核，或您需要帮助，请在此 PR 下留言说明情况。管理员可以人工处理或重跑检查；仅留言不会消除失败状态。",
      ),
    );
  }
  if (/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(reviewer ?? ""))
    content.push(
      pair(
        `Human review contact: @${reviewer}. This is an automated result, not their approval.`,
        `人工审核联系人：@${reviewer}。以上为自动检查结果，不代表该管理员已批准申请。`,
      ),
    );
  content.push(
    pair(
      `See the [submission guide](https://github.com/${repository}/blob/main/CONTRIBUTING.md). Format checks do not assess website content or prove external domain ownership.`,
      `请参考[申请指南](https://github.com/${repository}/blob/main/CONTRIBUTING.md)。格式检查不会判断网站内容，也不能证明仓库之外的域名所有权。`,
    ),
  );
  content.push(
    `<details>\n<summary>Technical details / 技术详情</summary>\n\n${pair(
      `Checked revision \`${safe(pr.head.sha)}\` against \`${safe(pr.base.sha)}\`. [Workflow run](${runUrl}).`,
      `已检查提交 \`${safe(pr.head.sha)}\`，基准为 \`${safe(pr.base.sha)}\`。[查看检查日志](${runUrl})。`,
    )}\n\n</details>`,
  );
  return content.join("\n\n");
}
