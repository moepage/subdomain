import { isIP } from "node:net";

export const MAX_FILES = 10;
export const MAX_BYTES = 32 * 1024;
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const username = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const label =
  /^(?:_[a-z\d](?:[a-z\d-]*[a-z\d])?|[a-z\d](?:[a-z\d-]*[a-z\d])?)$/;
export const validDomain = (value) =>
  typeof value === "string" &&
  value.length <= 244 &&
  value.split(".").every((part) => part.length <= 63 && label.test(part));
const hostname = (value) =>
  typeof value === "string" &&
  value.replace(/\.$/, "").length <= 253 &&
  value
    .replace(/\.$/, "")
    .split(".")
    .every(
      (part) =>
        part.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part),
    );

export function validateRecord(filename, text) {
  const errors = [];
  let config;
  if (Buffer.byteLength(text) > MAX_BYTES)
    return { errors: ["File exceeds 32 KiB."] };
  try {
    config = JSON.parse(text);
  } catch {
    return { errors: ["Invalid JSON."] };
  }
  if (!object(config)) return { errors: ["The JSON root must be an object."] };
  const allowed = ["owner", "domain", "records", "proxied", "ttl"];
  if (Object.keys(config).some((key) => !allowed.includes(key)))
    errors.push(
      "Unknown top-level field; allowed: owner, domain, records, proxied, ttl.",
    );
  if (
    !object(config.owner) ||
    typeof config.owner.username !== "string" ||
    !username.test(config.owner.username) ||
    Object.keys(config.owner).some(
      (key) => !["username", "email"].includes(key),
    )
  )
    errors.push(
      "owner must contain a GitHub username and optional email only.",
    );
  if (
    config.owner?.email !== undefined &&
    (typeof config.owner.email !== "string" ||
      (config.owner.email !== "" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.owner.email)))
  )
    errors.push("owner.email must be a valid email or an empty string.");
  if (
    !validDomain(config.domain) ||
    filename !== `records/${config.domain}.json`
  )
    errors.push(
      "domain must be lowercase DNS labels and match records/<domain>.json exactly.",
    );
  if (typeof config.proxied !== "boolean")
    errors.push("proxied must be true or false.");
  if (
    config.ttl !== undefined &&
    (!Number.isInteger(config.ttl) ||
      (config.ttl !== 1 && (config.ttl < 60 || config.ttl > 86400)))
  )
    errors.push("ttl must be 1 (automatic), or an integer from 60 to 86400.");
  if (!object(config.records) || !Object.keys(config.records).length)
    errors.push("records must be a non-empty object.");
  else {
    const types = Object.keys(config.records);
    if (types.includes("CNAME") && types.length !== 1)
      errors.push("CNAME cannot coexist with another record type.");
    if (
      config.proxied &&
      !types.some((type) => ["A", "AAAA", "CNAME"].includes(type))
    )
      errors.push("proxied is only available for A, AAAA, or CNAME.");
    for (const [type, input] of Object.entries(config.records)) {
      if (!["A", "AAAA", "CNAME", "TXT"].includes(type)) {
        errors.push(
          `Unsupported record type: ${type.slice(0, 80)}. Use A, AAAA, CNAME, or TXT.`,
        );
        continue;
      }
      const values = Array.isArray(input) ? input : [input];
      if (
        !values.length ||
        values.length > 20 ||
        values.some((value) => typeof value !== "string" || !value.trim()) ||
        new Set(values).size !== values.length
      ) {
        errors.push(`${type} must contain 1–20 unique, non-empty strings.`);
        continue;
      }
      if (type === "CNAME" && values.length !== 1)
        errors.push("CNAME must have exactly one target.");
      if (type === "A" && values.some((value) => isIP(value) !== 4))
        errors.push("A values must be IPv4 addresses.");
      if (type === "AAAA" && values.some((value) => isIP(value) !== 6))
        errors.push("AAAA values must be IPv6 addresses.");
      if (
        type === "CNAME" &&
        values.some(
          (value) =>
            !hostname(value) ||
            isIP(value.replace(/\.$/, "")) ||
            value.toLowerCase().replace(/\.$/, "") ===
              `${config.domain}.moe.page`,
        )
      )
        errors.push(
          "CNAME must be a hostname, without a URL, IP address, or self-reference.",
        );
      if (
        type === "TXT" &&
        values.some((value) => Buffer.byteLength(value) > 2048)
      )
        errors.push("TXT values must be at most 2048 UTF-8 bytes.");
    }
  }
  return { errors, config };
}

export function validateSubmission({
  files,
  commits,
  author,
  existing = [],
  body = "",
  baseRef = "main",
  draft = false,
}) {
  const errors = [];
  if (baseRef !== "main") errors.push("Submissions must target main.");
  if (draft)
    errors.push(
      "Mark the PR ready for review before requesting email approval.",
    );
  if (!body.replace(/<!--[\s\S]*?-->/g, "").trim())
    errors.push("Describe the purpose of your website in the PR description.");
  if (!files.length || files.length > MAX_FILES)
    errors.push(`A submission must change 1–${MAX_FILES} record files.`);
  if (!commits.length || commits.length > 100)
    errors.push("A submission must contain 1–100 commits.");
  for (const commit of commits) {
    if (commit.parents?.length > 1) continue;
    const subject = commit.commit.message.split("\n")[0];
    if (
      !subject.trim() ||
      subject.length > 200 ||
      /[\x00-\x1f\x7f]/.test(subject)
    ) {
      errors.push(
        `Commit ${commit.sha.slice(0, 7)}: use a non-empty, readable first line up to 200 characters. GitHub's default message is fine.`,
      );
    }
  }
  for (const file of files) {
    if (
      !/^records\/[^/]+\.json$/.test(file.filename) ||
      !["added", "modified"].includes(file.status)
    ) {
      errors.push(
        `${file.filename}: only added/modified records/*.json files qualify; maintenance, deletions, and renames need manual review.`,
      );
      continue;
    }
    const result = validateRecord(file.filename, file.text);
    errors.push(...result.errors.map((error) => `${file.filename}: ${error}`));
    if (!result.config || !validDomain(result.config.domain)) continue;
    const config = result.config;
    if (
      typeof config.owner?.username !== "string" ||
      config.owner.username.toLowerCase() !== author.toLowerCase()
    )
      errors.push(
        `${file.filename}: owner.username must match the PR author; delegated submissions need manual review.`,
      );
    for (const record of existing) {
      const related =
        record.filename === file.filename ||
        record.domain === config.domain ||
        record.domain.endsWith(`.${config.domain}`) ||
        config.domain.endsWith(`.${record.domain}`);
      if (
        related &&
        (typeof record.owner !== "string" ||
          record.owner.toLowerCase() !== author.toLowerCase())
      )
        errors.push(
          `${file.filename}: an existing record in this namespace belongs to another owner; manual review required.`,
        );
    }
    if (file.previousText !== undefined) {
      let previous;
      try {
        previous = JSON.parse(file.previousText);
      } catch {
        errors.push(
          `${file.filename}: existing invalid JSON requires manual repair.`,
        );
        continue;
      }
      if (previous.domain !== config.domain)
        errors.push(
          `${file.filename}: changing an existing domain requires manual review.`,
        );
      // The existing deployment script does not remove record types or old values.
      if (object(previous.records) && object(config.records)) {
        for (const [type, values] of Object.entries(previous.records)) {
          if (!(type in config.records))
            errors.push(
              `${file.filename}: removing/changing a DNS record type requires manual DNS cleanup.`,
            );
          else if (type !== "CNAME") {
            const before = Array.isArray(values) ? values : [values];
            const after = Array.isArray(config.records[type])
              ? config.records[type]
              : [config.records[type]];
            if (before.some((value) => !after.includes(value)))
              errors.push(
                `${file.filename}: removing/replacing ${type} values requires manual DNS cleanup.`,
              );
          }
        }
      }
    }
  }
  return { passed: errors.length === 0, errors };
}
