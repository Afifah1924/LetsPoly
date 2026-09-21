"use client";

import { useCallback, useSyncExternalStore } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";

/**
 * Google Analytics 4, gated behind the visitor's consent.
 *
 * GA4 sets cookies, so in the EU/UK it may only run *after* the visitor agrees.
 * The tag is therefore never part of the server-rendered HTML: the root layout
 * passes the measurement ID down and `<GoogleAnalytics />` is mounted only once
 * this component knows the answer. Declining loads nothing at all - no
 * `gtag.js` request, no cookies - which is the strictest form of Google's
 * Consent Mode ("basic" blocking), so no extra `gtag('consent', 'default', ...)`
 * call is needed for that to be compliant.
 *
 * The answer is remembered in localStorage and the footer offers "Analytics
 * settings" to change it, because withdrawing consent has to be as easy as
 * giving it. The tag is only in the page at all when `NEXT_PUBLIC_GA_ID` is set
 * (the root layout decides that), so an unconfigured checkout stays completely
 * tag-free.
 */

/** localStorage key holding the stored answer. */
const CONSENT_KEY = "letspoly_analytics_consent";

/**
 * Event the footer fires to re-open the banner.
 *
 * A DOM event rather than shared state because the banner lives in the root
 * layout and the footer has no reference to it - this keeps the client boundary
 * to one small component instead of a provider wrapped around the whole app.
 */
export const ANALYTICS_SETTINGS_EVENT = "letspoly:analytics-settings";

/**
 * Fired after the stored answer changes. `useSyncExternalStore` below needs an
 * event to tell React to re-read localStorage, because localStorage emits
 * nothing for writes made by the current tab.
 */
const CONSENT_CHANGE_EVENT = "letspoly:analytics-consent-change";

/** GA4's cookie names: the `_ga` pair (client + container) plus the Ads ones. */
const ANALYTICS_COOKIE_PATTERN = /^_(ga|gid|gat|gcl)/;

type Consent = "granted" | "denied";

/**
 * Answer kept when the browser refuses to store anything (Safari private
 * browsing, "block all cookies"). An in-memory copy honours the answer for this
 * page view instead of re-asking on every click - the same fallback the heart
 * counter uses so a storage-less visitor is never simply dropped.
 */
let memoryConsent: Consent | null = null;

function readStoredConsent(): Consent | null {
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    return memoryConsent;
  }
}

function storeConsent(value: Consent) {
  memoryConsent = value;
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Storage refused - `memoryConsent` above is the whole record.
  }
}

/**
 * Deletes the cookies `gtag.js` left behind.
 *
 * Declining has to mean "stop", and `gtag.js` cannot be unloaded in place, so a
 * withdrawal reloads the page - but a reload alone would leave `_ga` on the
 * device. The name is matched on the part before the first `=` only, because
 * cookie *values* may contain `=` themselves.
 */
function clearAnalyticsCookies() {
  const { hostname } = window.location;
  const expired = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0].trim();
    if (!ANALYTICS_COOKIE_PATTERN.test(name)) continue;
    // The same name is written on the host and on the registrable domain, so
    // both copies are cleared (a subdomain deployment would otherwise keep one).
    document.cookie = `${name}=; path=/; ${expired}`;
    document.cookie = `${name}=; path=/; domain=${hostname}; ${expired}`;
    document.cookie = `${name}=; path=/; domain=.${hostname}; ${expired}`;
  }
}

/**
 * Subscription for `useSyncExternalStore`: tells React when the answer changed.
 *
 * The "Analytics settings" write lives here rather than in an effect because
 * this is the single place that talks to the one external system involved, so
 * the write, the in-memory fallback and the notification stay together.
 */
function subscribe(onStoreChange: () => void) {
  const reopen = () => {
    memoryConsent = null;
    try {
      window.localStorage.removeItem(CONSENT_KEY);
    } catch {
      // Nothing was stored; the banner still re-opens.
    }
    onStoreChange();
  };

  window.addEventListener(ANALYTICS_SETTINGS_EVENT, reopen);
  window.addEventListener(CONSENT_CHANGE_EVENT, onStoreChange);
  // Another tab answering (or changing) the question.
  window.addEventListener("storage", onStoreChange);

  return () => {
    window.removeEventListener(ANALYTICS_SETTINGS_EVENT, reopen);
    window.removeEventListener(CONSENT_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** Browser snapshot: what this device has actually answered. */
function getSnapshot(): Consent | null {
  return readStoredConsent();
}

/**
 * Server/hydration snapshot: storage cannot be read there, so nobody has
 * answered yet. This is also what keeps the tag out of the server-rendered HTML
 * - a server render can never reach "granted".
 */
function getServerSnapshot(): Consent | null {
  return null;
}

/**
 * `true` only once the browser has taken over.
 *
 * The banner must NOT be in the server HTML: a visitor who already answered
 * would otherwise watch it flash on every page load until hydration finishes.
 * An external store whose snapshot is just "am I in a browser?" is the
 * lint-clean way to ask that (`setState` in an effect is exactly what
 * `react-hooks/set-state-in-effect` exists to prevent).
 */
const subscribeToNothing = () => () => {};
const readTrue = () => true;
const readFalse = () => false;

export default function AnalyticsConsent({ gaId }: { gaId: string }) {
  /**
   * Browser-only state, read the supported way: the server snapshot is "nobody
   * has answered yet", so the first render agrees with the server markup and
   * React swaps in the real answer the moment hydration finishes.
   */
  const consent = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(subscribeToNothing, readTrue, readFalse);

  const decide = useCallback(
    (value: Consent) => {
      const wasTracking = consent === "granted";
      storeConsent(value);
      window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
      // Withdrawing consent after the tag has already run is the one case that
      // needs a fresh page, because `gtag.js` has no unload API. The cookies go
      // first, so the reload cannot keep reporting.
      if (value === "denied" && wasTracking) {
        clearAnalyticsCookies();
        window.location.reload();
      }
    },
    [consent]
  );

  return (
    <>
      {/* The only place GA4 is ever mounted. */}
      {consent === "granted" && <GoogleAnalytics gaId={gaId} />}

      {hydrated && consent === null && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Analytics cookie consent"
          className="consent-rise fixed inset-x-0 bottom-0 z-[70] border-t border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur"
        >
          {/*
           * Same container as the footer, so the banner lines up with the page
           * content instead of running edge to edge. `z-[70]` sits above the
           * floating report button (z-50), which is reachable again as soon as
           * the banner is answered.
           */}
          <div className="mx-auto flex w-full max-w-full flex-col gap-3 px-4 py-4 sm:max-w-[min(90vw,1600px)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
            <p className="text-xs leading-relaxed text-slate-300 sm:text-sm">
              <span className="font-semibold text-slate-100">Analytics cookies.</span>{" "}
              May we use Google Analytics to count visits and see how LetsPoly is
              used? Nothing loads until you choose, and you can change your mind at
              any time with “Analytics settings” in the footer.
            </p>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => decide("denied")}
                className="min-h-10 touch-manipulation rounded-full border border-slate-600/70 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => decide("granted")}
                className="min-h-10 touch-manipulation rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
