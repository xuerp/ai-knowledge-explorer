export function safeReturnTo(value: string | null, origin: string, role: string) {
  if (!value) return "";
  try {
    const destination = new URL(value, origin);
    const allowedPath =
      destination.pathname === "/ask" ||
      /^\/research\/[^/]+$/.test(destination.pathname) ||
      (destination.pathname === "/admin/users" && role === "admin");
    if (destination.origin !== origin || !allowedPath) return "";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "";
  }
}
