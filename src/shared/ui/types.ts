export type StatusKind = "success" | "warning" | "error" | "neutral" | "info";

export function statusToColor(status: StatusKind): string {
  switch (status) {
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "error":
      return "red";
    case "info":
      return "blue";
    default:
      return "gray";
  }
}
