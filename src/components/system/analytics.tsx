import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Besöksstatistik med Umami (cookie-fri, ingen samtyckesbanner krävs).
 *
 * Aktiveras först när `VITE_UMAMI_WEBSITE_ID` finns i miljövariablerna.
 * Utan id laddas ingen extern skriptfil och inga requests skickas.
 *
 * Sidvisningar skickas manuellt (`data-auto-pageview="false"`) eftersom
 * appen är en SPA: Umami:s automatiska spårning ser bara första inläsningen.
 * Vi normaliserar dessutom `/rapport/<id>` till `/rapport/:id` så att enskilda
 * rapport-id:n aldrig hamnar i statistiken.
 */

type UmamiTracker = {
  track: (
    payload?:
      | Record<string, unknown>
      | ((props: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
};

const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
const scriptUrl =
  (import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined) ||
  "https://cloud.umami.is/script.js";
/** Valfri kommaseparerad lista, t.ex. "bilkopsassistenten.se,www.bilkopsassistenten.se". */
const allowedDomains = import.meta.env.VITE_UMAMI_DOMAINS as string | undefined;

function getTracker(): UmamiTracker | undefined {
  return (window as Window & { umami?: UmamiTracker }).umami;
}

/** `/rapport/abc123` -> `/rapport/:id` */
export function normalizeTrackedPath(pathname: string): string {
  return pathname.replace(/^\/rapport\/[^/]+$/, "/rapport/:id");
}

// Modulnivå så att React StrictMode (dubbelmontering i utvecklingsläge)
// inte injicerar skriptet två gånger eller skickar dubbel sidvisning.
let trackerPromise: Promise<boolean> | null = null;

function loadTracker(): Promise<boolean> {
  if (getTracker()) return Promise.resolve(true);
  if (trackerPromise) return trackerPromise;

  trackerPromise = new Promise<boolean>((resolve) => {
    if (!websiteId) {
      resolve(false);
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.defer = true;
    script.dataset.websiteId = websiteId;
    script.dataset.autoPageview = "false";
    script.dataset.excludeSearch = "true";
    script.dataset.excludeHash = "true";
    script.dataset.doNotTrack = "true";
    if (allowedDomains) script.dataset.domains = allowedDomains;

    script.addEventListener("load", () => resolve(Boolean(getTracker())), {
      once: true,
    });
    script.addEventListener(
      "error",
      () => {
        // Nätverksfel ska aldrig påverka appen; nästa sidvisning får försöka igen.
        trackerPromise = null;
        resolve(false);
      },
      { once: true },
    );

    document.head.appendChild(script);
  });

  return trackerPromise;
}

export function UmamiAnalytics() {
  const location = useLocation();
  const lastTrackedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!websiteId) return;

    const path = normalizeTrackedPath(location.pathname);
    let cancelled = false;

    void loadTracker().then((ready) => {
      if (!ready || cancelled || lastTrackedPath.current === path) return;
      const tracker = getTracker();
      if (!tracker) return;

      lastTrackedPath.current = path;
      tracker.track((props) => ({
        ...props,
        url: path,
        title: document.title,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  return null;
}
