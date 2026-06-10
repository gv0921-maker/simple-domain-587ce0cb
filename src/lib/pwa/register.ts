// Service worker registration wrapper following Lovable PWA skill safety rules.
// Refuses to register inside Lovable preview, iframes, or dev — and supports
// a `?sw=off` kill switch to unregister any existing app SW.

function isUnsafeHost(host: string): boolean {
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function unregisterAppSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
          return url.endsWith("/sw.js") || url.endsWith("/service-worker.js");
        })
        .map((r) => r.unregister()),
    );
  } catch {
    /* noop */
  }
}

export function registerPWA() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const inIframe = window.self !== window.top;
  const host = window.location.hostname;
  const isProd = import.meta.env.PROD;

  if (!isProd || inIframe || isUnsafeHost(host) || url.searchParams.get("sw") === "off") {
    void unregisterAppSW();
    return;
  }

  // Dynamic import so the workbox-window code is only loaded when we actually register.
  void import("workbox-window").then(({ Workbox }) => {
    const wb = new Workbox("/sw.js");
    wb.addEventListener("waiting", () => wb.messageSkipWaiting());
    void wb.register();
  });
}