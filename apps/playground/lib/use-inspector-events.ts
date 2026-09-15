"use client";

import { useSyncExternalStore } from "react";

import { type CaptureEvent, getEvents, getServerEvents, subscribe } from "./inspector-capture";

/** Live, ordered list of every captured event so far — re-renders whenever a new one arrives. */
export function useInspectorEvents(): readonly CaptureEvent[] {
  return useSyncExternalStore(subscribe, getEvents, getServerEvents);
}
