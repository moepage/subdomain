export const declineReasons = [
  {
    value: "Please describe the purpose of your website more clearly.",
    en: "More website details needed",
    zh: "请补充网站信息",
  },
  {
    value:
      "The requested domain or DNS records are not suitable. Please revise your submission.",
    en: "Domain or DNS issue",
    zh: "域名或 DNS 记录需要调整",
  },
  {
    value: "This submission does not meet the project's usage rules.",
    en: "Does not meet project rules",
    zh: "不符合项目使用规则",
  },
  {
    value: "inappropriate-content",
    en: "Inappropriate content",
    zh: "网站包含不适宜的内容",
  },
];

export function reviewerMention(login) {
  return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login ?? "")
    ? `@${login}`
    : "the maintainer";
}

export function approvalComment(login) {
  const reviewer = reviewerMention(login);
  return `Thanks for your submission! It has been reviewed and approved by ${reviewer}.  \n感谢您的提交！本申请已由 ${reviewer === "the maintainer" ? "管理员" : reviewer} 审核通过。`;
}

export function squashCommitMessage(commits, login, coauthor) {
  const authors = new Map();
  function add(name, email) {
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      !name.trim() ||
      /[\r\n<>]/.test(name) ||
      !/^[^\s<>@]+@[^\s<>@]+$/.test(email)
    )
      return;
    authors.set(email.toLowerCase(), `${name.trim()} <${email}>`);
  }
  // Preserve the existing commit authors and co-author trailers when supplying
  // our own squash message. These are attribution only, never authorization.
  for (const item of commits) {
    add(item.commit?.author?.name, item.commit?.author?.email);
    for (const match of (item.commit?.message ?? "").matchAll(
      /^Co-authored-by:\s*([^<>\r\n]+) <([^<>\r\n]+)>\s*$/gim,
    ))
      add(match[1], match[2]);
  }
  const reviewer = /^([^<>\r\n]+) <([^<>\r\n]+)>$/.exec(coauthor ?? "");
  if (!reviewer) throw new Error("Invalid reviewer co-author configuration.");
  add(reviewer[1], reviewer[2]);
  return `Reviewed and approved by ${reviewerMention(login)}.\n\n${[...authors.values()].map((author) => `Co-authored-by: ${author}`).join("\n")}`;
}

export function declineComment(selected, custom, login) {
  const reason = selected?.trim();
  const note = custom?.trim();
  const preset = declineReasons.find((item) => item.value === reason);
  if (reason && reason !== "custom" && !preset) return null;
  if ((!preset && !note) || note?.length > 1000) return null;
  // Two trailing spaces preserve line-by-line translations in GitHub Markdown.
  const explanation = [preset && `${preset.en}  \n${preset.zh}`, note]
    .filter(Boolean)
    .join("\n\n");
  const attribution = login
    ? `Your submission has been reviewed by ${reviewerMention(login)}.  \n本申请已由 ${reviewerMention(login)} 审核。\n\n`
    : "";
  return `Hi! Thanks for your submission. After reviewing it, we're unable to accept it for the following reason:  \n您好！感谢您的提交。经审核，我们暂时无法接受此申请，原因如下：\n\n${explanation}\n\n${attribution}Please update this pull request to address the feedback; it will remain open. You do not need to create a new PR.  \n请根据反馈修改当前 Pull Request；我们会保留此 PR，无需新建。\n\nFor website details, edit the first message at the top of this PR using **⋯ → Edit → Update comment**. For DNS or JSON changes, commit your fixes to the same PR branch.  \n补充网站信息时，请通过 PR 顶部第一条消息的 **⋯ → Edit（编辑）→ Update comment（更新评论）** 修改描述；调整 DNS 或 JSON 时，请将修改提交到同一 PR 分支。\n\nSaving the description or pushing a commit reruns the checks. Once they pass, your updated submission returns for review. If you changed the website itself, update the PR description to explain what you fixed.  \n保存描述或推送提交后，检查会自动重跑。通过后，更新后的申请会再次进入人工审核；如果修改的是网站本身，请在 PR 描述中说明已修复的内容。\n\nIf you need help, leave a comment here. A separate comment does not automatically rerun the checks. Thank you for understanding~(∠·ω< )⌒★  \n如需帮助，请在此 PR 下留言。单独留言不会自动重跑检查。感谢您的理解～(∠·ω< )⌒★`;
}
