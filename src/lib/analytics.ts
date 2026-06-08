/**
 * PostHog analytics — thin, safe wrapper.
 *
 * Configuration comes from Vite env vars (public, client-side key — safe to ship):
 *   VITE_POSTHOG_KEY   — PostHog project API key (required to enable analytics)
 *   VITE_POSTHOG_HOST  — ingestion host (defaults to reverse-proxy path /ingest)
 *
 * If VITE_POSTHOG_KEY is absent (e.g. local dev without a key), every function
 * below is a no-op, so analytics never breaks the app.
 */

import posthog from 'posthog-js';

// ─── Page name dictionary ─────────────────────────────────────────────────────
// Maps URL pathnames to human-readable names sent as `page_name` on $pageview.
// This lets PostHog funnels filter by readable step names instead of raw URLs.
const PAGE_NAME_MAP: Record<string, string> = {
  '/':                  'Landing',
  '/landing':           'Landing',
  '/login':             'Login',
  '/register':          'Register',
  '/forgot-password':   'Forgot Password',
  '/reset-password':    'Reset Password',
  '/success':           'Payment Success',
  '/oferta':            'Offer Agreement',
  '/privacy':           'Privacy Policy',
  '/dashboard':         'Dashboard',
  '/analysis':          'Analysis',
};

/**
 * Returns a human-readable page name for a given pathname.
 * Used as the `page_name` property on every $pageview event.
 */
export function getPageName(pathname: string): string {
  if (PAGE_NAME_MAP[pathname]) return PAGE_NAME_MAP[pathname];
  // /analysis/:id/feature/:featureName
  const featureMatch = pathname.match(/^\/analysis\/[^/]+\/feature\/(.+)$/);
  if (featureMatch) {
    const name = decodeURIComponent(featureMatch[1]).replace(/-/g, ' ');
    return `Feature Detail: ${name}`;
  }
  // /analysis/:id
  if (/^\/analysis\/[^/]+$/.test(pathname)) return 'Analysis Detail';
  return pathname;
}

// ─── Analysis screen names ────────────────────────────────────────────────────
// The /analysis route runs an internal state machine (no URL changes).
// Each screen transition fires `analysis_screen_viewed` with these names.
export const SCREEN_NAMES: Record<string, string> = {
  capture:        'Capture Method',
  guided_capture: 'Guided Camera',
  scanning:       'Scanning',
  report:         'Report',
} as const;

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
// Use the reverse-proxy path by default so events are not blocked by ad blockers.
// VITE_POSTHOG_HOST can override (e.g. for local dev without the proxy).
const HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || '/ingest';

/** True when a PostHog key is configured. */
export const analyticsEnabled = Boolean(KEY);

let started = false;

/** Initialise PostHog once. Call from the app entry point. */
export function initAnalytics(): void {
  if (!KEY || started) return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    // When using the reverse proxy, ui_host must point to PostHog directly
    // so the toolbar and session recordings link back to the right project.
    ui_host: 'https://us.posthog.com',
    // We are an SPA — capture pageviews manually on route change instead.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // Web vitals + page performance, so we can spot slow screens.
    capture_performance: true,
    // Autocapture unhandled JS errors → PostHog "Error tracking".
    capture_exceptions: true,
    // Session replay. Requires enabling Session Replay in PostHog project
    // settings. Inputs are masked for privacy (emails, phones, etc.).
    disable_session_recording: false,
    session_recording: { maskAllInputs: true },
    // Only create person profiles for identified (logged-in) users.
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
  });
}

/**
 * Canonical product/funnel event names.
 *
 * Naming convention: <noun>_<past_tense_verb>
 * All events fire with a `page_name` or `screen_name` property for easy
 * filtering in PostHog funnels without relying on raw URLs.
 */
export const EVENTS = {
  // ── Acquisition ──────────────────────────────────────────────────────────
  LANDING_CTA_CLICKED:    'landing_cta_clicked',    // props: { cta_location }

  // ── Activation / auth ─────────────────────────────────────────────────────
  USER_REGISTERED:        'user_registered',         // props: { needs_email_confirmation }
  USER_REGISTER_FAILED:   'user_register_failed',
  USER_LOGGED_IN:         'user_logged_in',
  USER_LOGIN_FAILED:      'user_login_failed',
  USER_LOGGED_OUT:        'user_logged_out',

  // ── Analysis flow ─────────────────────────────────────────────────────────
  // Fired on every internal screen transition inside /analysis
  ANALYSIS_SCREEN_VIEWED: 'analysis_screen_viewed', // props: { screen, screen_name, source? }
  CAPTURE_METHOD_SELECTED:'capture_method_selected', // props: { method: 'camera'|'upload' }
  GUIDED_CAPTURE_STARTED: 'guided_capture_started',
  PHOTOS_UPLOADED:        'photos_uploaded',
  ANALYSIS_STARTED:       'analysis_started',        // props: { source }
  ANALYSIS_COMPLETED:     'analysis_completed',      // props: { source }
  ANALYSIS_FAILED:        'analysis_failed',
  SCAN_FAILED:            'scan_failed',
  AI_RECS_FAILED:         'ai_recs_failed',

  // ── Report engagement ─────────────────────────────────────────────────────
  PAYWALL_VIEWED:         'paywall_viewed',
  REPORT_VIEWED:          'report_viewed',
  PDF_DOWNLOADED:         'pdf_downloaded',
  FEATURE_DETAIL_VIEWED:  'feature_detail_viewed',  // props: { feature_name, analysis_id }

  // ── Monetization ──────────────────────────────────────────────────────────
  KASPI_UPLOAD_OPENED:    'kaspi_upload_opened',
  KASPI_PAYMENT_SUBMITTED:'kaspi_payment_submitted',
  PAYMENT_VERIFIED:       'payment_verified',        // props: { amount_kzt }
  PAYMENT_PENDING:        'payment_pending',
  PAYMENT_FAILED:         'payment_failed',
  PAYMENT_SUCCESS_PAGE:   'payment_success_page_viewed', // confirmation page mount

  // ── Consultation conversion ───────────────────────────────────────────────
  WHATSAPP_CTA_CLICKED:   'whatsapp_cta_clicked',   // props: { location }

  // ── Retention ─────────────────────────────────────────────────────────────
  DASHBOARD_VIEWED:       'dashboard_viewed',        // props: { analyses_count }
  PAST_ANALYSIS_OPENED:   'past_analysis_opened',   // props: { analysis_id }
} as const;

type EventProps = Record<string, unknown>;

/** Capture a custom event. */
export function track(event: string, props?: EventProps): void {
  if (!KEY) return;
  posthog.capture(event, props);
}

/**
 * Capture a manual SPA pageview.
 * Pass `extraProps` to attach properties like `page_name` — these show up
 * in PostHog's event explorer and can be used as funnel step filters.
 */
export function trackPageview(url?: string, extraProps?: EventProps): void {
  if (!KEY) return;
  posthog.capture('$pageview', {
    ...(url ? { $current_url: url } : {}),
    ...extraProps,
  });
}

/** Associate subsequent events with a known user. */
export function identifyUser(id: string, props?: EventProps): void {
  if (!KEY) return;
  posthog.identify(id, props);
}

/** Clear identity on logout so events aren't attributed to the wrong user. */
export function resetAnalytics(): void {
  if (!KEY) return;
  posthog.reset();
}

export { posthog };
