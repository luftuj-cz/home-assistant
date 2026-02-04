function computeBaseUrl(): URL {
  const url = new URL(window.location.origin);
  let path = window.location.pathname;

  if (!path.endsWith("/") && path.split("/").pop()?.includes(".")) {
    path = path.substring(0, path.lastIndexOf("/") + 1);
  }

  if (!path.endsWith("/")) {
    path += "/";
  }

  url.pathname = path;
  return url;
}

const apiBase = computeBaseUrl();

function normalisePath(path: string): string {
  if (!path) {
    return "";
  }
  return path.startsWith("/") ? path.slice(1) : path;
}

export function resolveApiUrl(path: string): string {
  const target = new URL(normalisePath(path), apiBase);
  return target.toString();
}

export function resolveWebSocketUrl(path: string): string {
  const target = new URL(normalisePath(path), apiBase);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
}
