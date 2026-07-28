/**
 * How long the object URL is kept alive after the click. Revoking it in the
 * same task can abort the transfer in Firefox and Safari before the browser
 * has finished reading the blob, which shows up as a silently missing file.
 * The blob is released once this fires.
 */
const OBJECT_URL_TTL_MS = 40_000;

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";

  // Some browsers (notably Firefox) ignore clicks on anchors that are not in
  // the document, so attach it for the duration of the click.
  document.body.appendChild(link);
  link.click();
  link.remove();

  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_TTL_MS);
}
