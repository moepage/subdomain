# ฅ●ω●ฅ moe.page — Free, cute subdomains

[简体中文](README.md) | **English**

[![GitHub Actions Status](https://github.com/moepage/subdomain/actions/workflows/deploy.yml/badge.svg)](https://github.com/moepage/subdomain/actions)

> Get your own `.moe.page` subdomain with a pull request!

## ✨ What is this?

`moe.page` is a free, open, automated subdomain registration project. It gives your personal projects, blogs, homepages, and creative ideas a cute, memorable address.

## 🚀 How to apply

### Step 1: Fork this repository

Click **Fork** at the top right to copy this project to your GitHub account.

### Step 2: Add your domain file

1. Open the `records/` directory in your fork.
2. Select **Add file → Create new file**.
3. Name the file after the subdomain you want, with a `.json` extension. For `luna.moe.page`, use `luna.json`.

### Step 3: Fill in your configuration

Copy this template into the new file and replace the example values:

```json
{
  "owner": {
    "username": "your-github-username",
    "email": "you@example.com"
  },
  "domain": "luna",
  "records": {
    "A": ["1.2.3.4"]
  },
  "proxied": false
}
```

- `owner`: Your GitHub username and optional contact email. Your username must match the PR author for automated review. Contact emails committed here are public; omit the field or leave it empty if you prefer.
- `domain`: Your requested subdomain. It must match the filename exactly, in lowercase.
- `records`: Your DNS records. `A` points to an IPv4 address, `AAAA` to an IPv6 address, `CNAME` to another hostname, and `TXT` contains text, often used for verification. Values may be a string or an array of strings. A CNAME must have exactly one target and cannot coexist with any other record type.
- `proxied`: Whether to enable the Cloudflare proxy (orange cloud). This must be a Boolean and applies only to A, AAAA, and CNAME records.
- `ttl` (optional): `1` for automatic TTL, or a number of seconds from `60` to `86400`. The deployment defaults to `120` and uses automatic TTL for proxied records.

Nested names such as `wiki.luna` and verification labels such as `_atproto.luna` are supported. Existing namespaces cannot be claimed by another owner through automated approval.

### Step 4: Submit a pull request

1. Keep GitHub’s default commit message (such as `Create luna.json`) or write a short description. No special commit format is required.
2. Return to your fork's homepage and select **Contribute → Open pull request**.
3. Target `main` and describe what your website does in the PR description.
4. The bot checks commit messages, JSON and DNS formats, and recorded ownership, then leaves or updates a comment explaining the result.
5. After the checks pass, a maintainer reviews the submission. When email review is configured, they receive the submission details and private links to approve and merge, or decline with a message.
6. Once merged, GitHub Actions deploys the DNS records. Check the deployment result; DNS changes can take time to become visible.

Automated checks validate format, not website safety. Maintenance changes, ownership transfers, record deletion, and changes requiring removal of old DNS values need manual review.

## 📜 Rules and limitations

1. Do not use these domains for illegal or inappropriate content, including phishing, spam, or adult content.
2. A CNAME cannot coexist with any other DNS record type.
3. We reserve the right to remove abused domains at any time.

## Maintainer setup

See [review automation setup](docs/review-automation.md) for the GitHub workflow, email delivery, and the small Cloudflare review service. The email links show details and require a deliberate button press before changing a PR.

## Acknowledgments

Thanks to [Cloudflare](https://www.cloudflare.com/) for its infrastructure and support.

---

Get started with your own `.moe.page` subdomain!
