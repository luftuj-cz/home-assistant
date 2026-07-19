export async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy fallbacks (e.g. clipboard blocked in a sandboxed ingress iframe)
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let execCommandSucceeded = false;
  try {
    // document.execCommand is deprecated but has no replacement for this
    // fallback path (used only when the async Clipboard API is unavailable).
    execCommandSucceeded = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (execCommandSucceeded) {
    return;
  }

  // Last resort: native prompt() dialog is unaffected by iframe clipboard
  // permission sandboxing, so the user can still copy manually.
  const promptResult = window.prompt("Copy to clipboard: Ctrl+C, Enter", text);
  if (promptResult === null) {
    throw new Error("Clipboard copy was cancelled");
  }
}
