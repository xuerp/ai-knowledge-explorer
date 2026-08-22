export type BackNavigationAction = "history" | "home";

export function backNavigationFor(
  pathname: string,
  historyLength: number,
): { visible: boolean; action: BackNavigationAction } {
  return {
    visible: pathname !== "/",
    action: historyLength > 1 ? "history" : "home",
  };
}
