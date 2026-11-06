export type BackNavigationAction = "history" | "home";

const topLevelPages = new Set(["/", "/updates", "/knowledge", "/ask", "/graph", "/case-study"]);

export function backNavigationFor(
  pathname: string,
  historyLength: number,
): { visible: boolean; action: BackNavigationAction } {
  return {
    visible: !topLevelPages.has(pathname.replace(/\/$/, "") || "/"),
    action: historyLength > 1 ? "history" : "home",
  };
}
