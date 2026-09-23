import {
  MAX_BYTES,
  MAX_FILES,
  validateSubmission,
  validDomain,
} from "./validate-submission.js";

export function githubClient(token, repository, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error("Invalid repository.");
  return async (path, options = {}) => {
    const response = await fetcher(
      `https://api.github.com/repos/${repository}${path}`,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "moe-page-review",
          ...options.headers,
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub request failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
}

export async function readRecord(api, filename, ref) {
  const data = await api(
    `/contents/${filename.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
  );
  if (
    data.type !== "file" ||
    data.encoding !== "base64" ||
    data.size > MAX_BYTES
  )
    throw new Error(
      "Record must be a regular UTF-8 JSON file no larger than 32 KiB.",
    );
  return Buffer.from(data.content, "base64").toString("utf8");
}

export async function collectReview(api, number) {
  const pr = await api(`/pulls/${number}`);
  const result = { pr, passed: false, errors: [], files: [] };
  if (pr.state !== "open")
    return { ...result, errors: ["PR is no longer open."] };
  if (pr.changed_files > MAX_FILES || pr.commits > 100)
    return {
      ...result,
      errors: ["Too many changed files or commits; manual review required."],
    };
  const [files, commits, tree] = await Promise.all([
    api(`/pulls/${number}/files?per_page=100`),
    api(`/pulls/${number}/commits?per_page=100`),
    api(`/git/trees/${pr.base.sha}?recursive=1`),
  ]);
  if (
    tree.truncated ||
    files.length !== pr.changed_files ||
    commits.length !== pr.commits
  )
    return {
      ...result,
      errors: ["Incomplete GitHub data; retry or review manually."],
    };
  const safeFiles = files.filter(
    (file) =>
      /^records\/[^/]+\.json$/.test(file.filename) &&
      ["added", "modified"].includes(file.status),
  );
  // Inspect git object modes; the contents API can resolve symlinks as regular files.
  const headTree = await api(`/git/trees/${pr.head.sha}?recursive=1`);
  if (headTree.truncated)
    return {
      ...result,
      errors: ["Incomplete head tree; manual review required."],
    };
  for (const file of safeFiles) {
    const entry = headTree.tree.find((item) => item.path === file.filename);
    if (entry?.mode !== "100644" || entry.type !== "blob")
      return {
        ...result,
        errors: [`${file.filename}: must be a regular non-executable file.`],
      };
    file.text = await readRecord(api, file.filename, pr.head.sha);
    if (file.status === "modified")
      file.previousText = await readRecord(api, file.filename, pr.base.sha);
  }
  const domains = safeFiles
    .map((file) => file.filename.slice(8, -5))
    .filter(validDomain);
  const existing = [];
  // Read all current records so legacy domain/filename mismatches cannot hide a collision.
  const records = tree.tree.filter((item) =>
    /^records\/[^/]+\.json$/.test(item.path),
  );
  if (records.length > 1000)
    return {
      ...result,
      errors: [
        "Repository exceeds automatic namespace scan limit; manual review required.",
      ],
    };
  if (domains.length) {
    // Five concurrent reads bound API pressure while keeping watch page actions responsive.
    for (let offset = 0; offset < records.length; offset += 5) {
      const batch = await Promise.all(
        records.slice(offset, offset + 5).map(async (entry) => {
          if (entry.mode !== "100644")
            throw new Error(
              "Existing record is not a regular file; manual review required.",
            );
          const config = JSON.parse(
            await readRecord(api, entry.path, pr.base.sha),
          );
          if (typeof config.domain !== "string")
            throw new Error(`Cannot verify namespace in ${entry.path}.`);
          return [
            {
              filename: entry.path,
              domain: config.domain.toLowerCase(),
              owner: config.owner?.username,
            },
            // Reserve the filename too, including legacy mismatched records.
            {
              filename: entry.path,
              domain: entry.path.slice(8, -5),
              owner: config.owner?.username,
            },
          ];
        }),
      );
      existing.push(...batch.flat());
    }
  }
  const validation = validateSubmission({
    files,
    commits,
    existing,
    author: pr.user.login,
    body: pr.body ?? "",
    baseRef: pr.base.ref,
    draft: pr.draft,
  });
  const fresh = await api(`/pulls/${number}`);
  if (
    fresh.head.sha !== pr.head.sha ||
    fresh.base.sha !== pr.base.sha ||
    fresh.state !== "open"
  )
    return {
      ...result,
      errors: ["PR changed during validation; rerun the review."],
    };
  return { ...result, ...validation, files };
}
