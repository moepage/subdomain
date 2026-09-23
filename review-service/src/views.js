export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function details(snapshot) {
  const { pr, files, comments = [] } = snapshot;
  return `<h2>PR #${pr.number}: ${escape(pr.title)}</h2><p><strong>GitHub user:</strong> ${escape(pr.user.login)}</p><p><strong>PR description:</strong></p><pre>${escape(pr.body || "(No description)")}</pre>${files
    .map((file) => {
      const record = JSON.parse(file.text);
      return `<section><h2>${escape(record.domain)}.moe.page</h2><p><strong>Owner:</strong> ${escape(record.owner.username)}<br><strong>Contact email:</strong> ${escape(record.owner.email || "(Not provided)")}<br><strong>Change:</strong> ${escape(file.status)}<br><strong>Cloudflare proxy:</strong> ${record.proxied ? "On" : "Off"}<br><strong>TTL:</strong> ${record.proxied ? "Automatic for proxied records; otherwise " : ""}${escape(record.ttl ?? "120 (default)")}</p><pre>${escape(JSON.stringify(record.records, null, 2))}</pre>${file.previousText === undefined ? "" : `<details><summary>Previous configuration</summary><pre>${escape(file.previousText)}</pre></details>`}</section>`;
    })
    .join(
      "",
    )}<h2>Recent discussion</h2>${comments.length ? comments.map((comment) => `<p><strong>${escape(comment.user.login)}</strong></p><pre>${escape(comment.body)}</pre>`).join("") : "<p>No comments at the time of notification.</p>"}<p><small>Revision ${escape(pr.head.sha.slice(0, 12))}. The excerpt includes the latest 10 discussion comments (up to 2,000 characters each); open GitHub for the full discussion and diff.</small></p>`;
}
export function detailsText(snapshot) {
  const { pr, files, comments = [] } = snapshot;
  return [
    `PR #${pr.number}: ${pr.title}`,
    `GitHub user: ${pr.user.login}`,
    `PR description:\n${pr.body || "(No description)"}`,
    ...files.map((file) => {
      const record = JSON.parse(file.text);
      return `Domain: ${record.domain}.moe.page\nOwner: ${record.owner.username}\nContact email: ${record.owner.email || "(Not provided)"}\nChange: ${file.status}\nProxy: ${record.proxied}\nTTL: ${record.proxied ? "Automatic for proxied records; otherwise " : ""}${record.ttl ?? 120}\nRecords:\n${JSON.stringify(record.records, null, 2)}${file.previousText === undefined ? "" : `\nPrevious configuration:\n${file.previousText}`}`;
    }),
    "Recent discussion (latest 10; 2,000 characters each):",
    ...comments.map((comment) => `${comment.user.login}: ${comment.body}`),
    `Revision: ${pr.head.sha}`,
  ].join("\n\n");
}
export function page(title, content, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)} · moe.page</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#182033;max-width:38rem;margin:auto;padding:14px}h1{font-size:1.5rem}h2{font-size:1.15rem}section,form{background:white;border:1px solid #dce0e8;border-radius:12px;padding:12px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}button,select,textarea{font:inherit;box-sizing:border-box;width:100%;min-height:48px;margin:8px 0}button{border:0;border-radius:9px;background:#166534;color:white;padding:12px;font-weight:700}.decline{background:#a12736}textarea{min-height:90px}a{color:#234fa4;overflow-wrap:anywhere}small{overflow-wrap:anywhere}label{display:block}p{overflow-wrap:anywhere}</style></head><body><h1>${escape(title)}</h1>${content}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
export function reviewPage(snapshot, token, prUrl) {
  return page(
    "Review submission",
    `<p>Format checks passed. Review the website and DNS details before deciding. Opening this page does not change the PR.</p>${details(snapshot)}<p><a href="${escape(prUrl)}">Open full PR on GitHub</a></p><form method="post" action="/decision"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="approve"><button type="submit">Approve &amp; merge</button></form><form id="decline" method="post" action="/decision"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="decline"><label for="reason">Decline message</label><select id="reason" name="reason"><option value="Please describe the purpose of your website more clearly.">More website details needed</option><option value="The requested domain or DNS records are not suitable. Please revise your submission.">Domain or DNS issue</option><option value="This submission does not meet the project's usage rules.">Does not meet project rules</option><option value="custom">Custom message below</option></select><label for="message">Custom message (optional)</label><textarea id="message" name="message" maxlength="1000" placeholder="Dictate or type your message"></textarea><button class="decline" type="submit">Decline &amp; close PR</button></form><p><small>The links expire after 24 hours and stop working when the PR revision or main branch changes. Keep this email private: anyone with the link can act on this submission.</small></p>`,
  );
}
