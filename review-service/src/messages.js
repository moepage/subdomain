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
  return `Hi! Thanks for your submission. After reviewing it, we're unable to accept it for the following reason:  \n您好！感谢您的提交。经审核，我们暂时无法接受此申请，原因如下：\n\n${explanation}\n\n${attribution}You're welcome to open a new pull request once you've addressed this feedback. Thank you for understanding~(∠·ω< )⌒★  \n处理完这些反馈后，欢迎您提交新的 Pull Request。感谢您的理解～(∠·ω< )⌒★`;
}
