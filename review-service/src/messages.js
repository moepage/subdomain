export function declineComment(selected, custom) {
  const reason = selected?.trim();
  const note = custom?.trim();
  const preset = reason && reason !== "custom" ? reason : "";
  if ((!preset && !note) || preset.length > 1000 || note?.length > 1000)
    return null;
  const explanation = [preset, note].filter(Boolean).join("\n\n");
  return `Hi! Thanks for your submission. After reviewing it, we're unable to accept it for the following reason:\n\n${explanation}\n\nYou're welcome to open a new pull request once you've addressed this feedback. Thank you for understanding!`;
}
