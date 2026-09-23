import { expect, test } from "vitest";
import { squashCommitMessage } from "../src/messages.js";

test("squash attribution retains contributors and adds the reviewer once", () => {
  const message = squashCommitMessage(
    [
      {
        commit: {
          author: { name: "Alice", email: "alice@example.com" },
          message: "Add a record\n\nCo-authored-by: Bob <bob@example.com>",
        },
      },
      {
        commit: {
          author: { name: "Alice", email: "alice@example.com" },
          message:
            "Update\n\nCo-authored-by: maoawa <85821597+maoawa@users.noreply.github.com>",
        },
      },
    ],
    "maoawa",
    "maoawa <85821597+maoawa@users.noreply.github.com>",
  );
  expect(message).toContain("Co-authored-by: Alice <alice@example.com>");
  expect(message).toContain("Co-authored-by: Bob <bob@example.com>");
  expect(message.match(/Co-authored-by: maoawa/g)).toHaveLength(1);
  expect(message).toContain("Reviewed and approved by @maoawa.");
});
