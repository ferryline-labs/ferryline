/**
 * The playground's protocol inspector: passively observes real network traffic and real widget
 * state transitions already happening, rather than fabricating placeholder data or making any
 * second, duplicate network call of its own.
 *
 * Two interceptors, installed once, client-side only:
 *
 * 1. `window.fetch` — confirmed directly (not assumed) that every real HTTP call this page's
 *    widget makes already goes through the global `fetch`: `@stellar/stellar-sdk`'s RPC client
 *    (`feaxios`, its own real HTTP layer) calls bare `fetch()` for `sendTransaction`/
 *    `getTransaction`; `packages/widget/src/relayer.ts` calls `fetch()` directly for registration
 *    and status polling; `@ferryline/sdk`'s `createIrisClient` (packages/sdk/src/rails/usdc-cctp/
 *    iris.ts) defaults its `fetchFn` parameter to the bare global `fetch` too, and nothing in this
 *    app or the widget overrides that default. One wrapper here observes all three real call
 *    families — Soroban RPC (including the real signed XDR, in `sendTransaction`'s own request
 *    body), the relayer, and Circle's Iris attestation service — with zero additional network
 *    traffic beyond what the widget was already generating on its own.
 *
 * 2. `console.log` — filtered to exactly the `"[ferryline-widget] phase -> "` line
 *    (packages/widget/src/index.ts's `setPhase`), whose second argument is the real, fully-typed
 *    `WidgetPhase` union already exported from `@ferryline/widget`. This is the structured "which
 *    stage are we in" signal the raw fetch events don't cleanly give on their own (a quote, a
 *    built transfer, a decoded step index).
 *
 * Safety, structural not redaction-based (per the pre-build safety pass): `CaptureEvent` has no
 * `headers` field in its type at all — request/response HEADERS are never read, matched against,
 * or stored anywhere in this file, which is what actually keeps a configured relayer API key
 * (sent as an `Authorization` header, see relayer.ts) out of every captured event, not a display-
 * time filter that a future edit could accidentally bypass.
 */
"use client";

import type { WidgetPhase } from "@ferryline/widget";

export type CaptureEvent =
  | {
      readonly kind: "phase";
      readonly id: string;
      readonly timestamp: number;
      readonly phase: WidgetPhase;
    }
  | {
      readonly kind: "fetch";
      readonly id: string;
      readonly timestamp: number;
      readonly url: string;
      readonly method: string;
      readonly requestBody: unknown;
      readonly responseStatus: number | undefined;
      readonly responseOk: boolean | undefined;
      readonly responseBody: unknown;
      readonly error: string | undefined;
    };

let events: readonly CaptureEvent[] = [];
const listeners = new Set<() => void>();

function emit(event: CaptureEvent): void {
  events = [...events, event];
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEvents(): readonly CaptureEvent[] {
  return events;
}

// A module-level constant, not a literal returned fresh each call: useSyncExternalStore requires
// its server-snapshot function to return a referentially STABLE value when nothing has changed —
// confirmed for real, not just from the docs, by a live "The result of getServerSnapshot should
// be cached to avoid an infinite loop" React warning the first time this returned `[]` inline.
// apps/site's own reduced-motion hook never hit this because its server snapshot is a primitive
// boolean (compares by value); an array is compared by reference, so a fresh `[]` every call reads
// as "changed" on every render.
const EMPTY_EVENTS: readonly CaptureEvent[] = [];

/** SSR-safe snapshot: no capture exists on the server, and the client corrects it on first
 *  paint — same "server default is safe, client corrects it" shape as this project's other
 *  useSyncExternalStore hooks (e.g. apps/site's reduced-motion detection). */
export function getServerEvents(): readonly CaptureEvent[] {
  return EMPTY_EVENTS;
}

export function clearEvents(): void {
  events = [];
  for (const listener of listeners) listener();
}

function newId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

/** Best-effort JSON parse of a request body — never reads `init.headers` or a Request's own
 *  `.headers`, only `.body`/a cloned `.text()`, which is what structurally keeps this from ever
 *  touching an Authorization header. */
async function readRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<unknown> {
  try {
    if (typeof init?.body === "string") {
      try {
        return JSON.parse(init.body) as unknown;
      } catch {
        return init.body;
      }
    }
    if (typeof input !== "string" && !(input instanceof URL) && input.method !== "GET") {
      const text = await input.clone().text();
      if (!text) return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let installed = false;

/** Idempotent: safe to call from every component that wants capture running (each just no-ops
 *  after the first real call). Client-only — never called during SSR. */
export function installInspectorCapture(): void {
  if (installed) return;
  installed = true;
  installFetchCapture();
  installConsoleCapture();
}

/** Test-only seam, the same shape as @ferryline/widget's own testClientOverride/testWalletOverride:
 *  lets inspector-capture.test.ts re-install capture against a fresh window.fetch mock in each
 *  test, rather than the first test's wrapped closure (over that test's own now-stale mock)
 *  silently persisting for the rest of the file. Never called from real app code. */
export function __resetInstalledForTests(): void {
  installed = false;
}

function installFetchCapture(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const id = newId();
    const timestamp = Date.now();
    const url = urlOf(input);
    const method = methodOf(input, init);
    const requestBody = await readRequestBody(input, init);
    try {
      const response = await originalFetch(input, init);
      const responseBody = await readResponseBody(response);
      emit({
        kind: "fetch",
        id,
        timestamp,
        url,
        method,
        requestBody,
        responseStatus: response.status,
        responseOk: response.ok,
        responseBody,
        error: undefined,
      });
      return response;
    } catch (error) {
      emit({
        kind: "fetch",
        id,
        timestamp,
        url,
        method,
        requestBody,
        responseStatus: undefined,
        responseOk: undefined,
        responseBody: undefined,
        error: messageOf(error),
      });
      throw error;
    }
  };
}

const PHASE_LOG_PREFIX = "[ferryline-widget] phase -> ";

/**
 * Capturing the widget's own real diagnostic log lines is this function's entire job — both the
 * read (to preserve normal devtools output) and the override below are the intentional mechanism,
 * not stray debug output, hence the two no-console disables immediately below.
 */
function installConsoleCapture(): void {
  // eslint-disable-next-line no-console -- see the function's own doc comment above
  const originalLog = console.log.bind(console);
  // eslint-disable-next-line no-console -- see the function's own doc comment above
  console.log = (...args: unknown[]): void => {
    originalLog(...args);
    const [message, data] = args;
    if (typeof message === "string" && message.startsWith(PHASE_LOG_PREFIX) && data) {
      emit({
        kind: "phase",
        id: newId(),
        timestamp: Date.now(),
        phase: data as WidgetPhase,
      });
    }
  };
}
