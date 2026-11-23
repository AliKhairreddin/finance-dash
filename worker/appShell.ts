type AppShell = "top-up" | "receipt-capture" | "statements";

export function fetchAppShell(assets: WorkerEnv["ASSETS"], request: Request, shell: AppShell) {
  return assets.fetch(new Request(new URL(`/${shell}`, request.url), request));
}

export function isPublicTopUpPath(pathname: string) {
  return ["/top-up", "/top-up/", "/payments", "/payments/"].includes(pathname);
}
