const authenticated = new WeakSet<object>();

export function rememberAuthenticated<T extends object>(event: T): T {
  authenticated.add(event);
  return event;
}

export function isAuthenticated(event: unknown): boolean {
  return (
    typeof event === "object" && event !== null && authenticated.has(event)
  );
}
