import { declineReasons } from "./messages.js";

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
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark"><title>${escape(title)} · moe.page</title><style>:root{color-scheme:dark}body{font:16px/1.5 system-ui,sans-serif;background:#0b0f16;color:#e8edf5;max-width:38rem;margin:auto;padding:14px}h1{font-size:1.5rem}h2{font-size:1.15rem}section,form{background:#161c26;border:1px solid #344052;border-radius:12px;padding:12px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}button,select,textarea{font:inherit;box-sizing:border-box;width:100%;min-height:48px;margin:8px 0}button{border:0;border-radius:9px;background:#237549;color:white;padding:12px;font-weight:700}.decline{background:#a83245}select,textarea{background:#0f1520;color:#e8edf5;border:1px solid #56647a;border-radius:8px;padding:10px}textarea{min-height:90px}textarea::placeholder{color:#adb8c9}button:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid #8fc8ff;outline-offset:3px}small{color:#b5c0d1}a{color:#a6c8ff;overflow-wrap:anywhere}small{overflow-wrap:anywhere}label{display:block}p{overflow-wrap:anywhere}</style></head><body><h1>${escape(title)}</h1>${content}</body></html>`,
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
    `<p>Format checks passed. Review the website and DNS details before deciding. Opening this page does not change the PR.</p>${details(snapshot)}<p><a href="${escape(prUrl)}">Open full PR on GitHub</a></p><form method="post" action="/decision"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="approve"><button type="submit">Approve &amp; merge</button></form><form id="decline" method="post" action="/decision"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="action" value="decline"><label for="reason">Reason for requesting changes</label><select id="reason" name="reason">${declineReasons.map((reason) => `<option value="${escape(reason.value)}">${escape(reason.en)} — ${escape(reason.zh)}</option>`).join("")}<option value="custom">Custom reason below — 在下方填写原因</option></select><label for="message">Additional note (optional)</label><textarea id="message" name="message" maxlength="1000" placeholder="Dictate or type your message"></textarea><p><small>The selected reason and any additional note will be posted publicly as review feedback. The PR stays open for the applicant to update. If you choose a custom reason, enter it above.</small></p><button class="decline" type="submit">Request changes</button></form><p><small>The links expire after 24 hours and stop working when the PR description, title, revision, or main branch changes. Keep this email private: anyone with the link can act on this submission.</small></p>`,
  );
}
