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

export function declineComment(selected, custom) {
  const reason = selected?.trim();
  const note = custom?.trim();
  const preset = declineReasons.find((item) => item.value === reason);
  if (reason && reason !== "custom" && !preset) return null;
  if ((!preset && !note) || note?.length > 1000) return null;
  // Two trailing spaces preserve line-by-line translations in GitHub Markdown.
  const explanation = [preset && `${preset.en}  \n${preset.zh}`, note]
    .filter(Boolean)
    .join("\n\n");
  return `Hi! Thanks for your submission. After reviewing it, we're unable to accept it for the following reason:  \n您好！感谢您的提交。经审核，我们暂时无法接受此申请，原因如下：\n\n${explanation}\n\nYou're welcome to open a new pull request once you've addressed this feedback. Thank you for understanding! ฅ●ω●ฅ  \n处理完这些反馈后，欢迎您提交新的 Pull Request。感谢您的理解～(∠·ω< )⌒★`;
}
