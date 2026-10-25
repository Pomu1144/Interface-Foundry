import { studio } from '@/store';
import { onActionRun } from '@/app/actions';

/**
 * Telemetry adapter. IFDY sends nothing anywhere. When the user opts in, product
 * events are kept in an in-memory ring buffer they can inspect or download; an
 * organisation can swap in its own sink by calling `setTelemetrySink`.
 */
export type TelemetryEvent = { name: string; at: number; data?: Record<string, string | number | boolean> };

const MAX = 500;
const buffer: TelemetryEvent[] = [];
let sink: ((e: TelemetryEvent) => void) | null = null;

export function track(name: string, data?: TelemetryEvent['data']) {
  if (!studio().settings.telemetry) return;
  const e = { name, at: Date.now(), data };
  buffer.push(e);
  if (buffer.length > MAX) buffer.shift();
  sink?.(e);
}

export function telemetryEvents(): TelemetryEvent[] {
  return [...buffer];
}

export function clearTelemetry() {
  buffer.length = 0;
}

/** Explicit, opt-in integration point for self-hosted analytics. */
export function setTelemetrySink(fn: ((e: TelemetryEvent) => void) | null) {
  sink = fn;
}

export function startTelemetry() {
  onActionRun((id) => track('action', { id }));
}
