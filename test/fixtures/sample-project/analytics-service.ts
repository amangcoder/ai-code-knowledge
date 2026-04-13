/**
 * AnalyticsService - leaf node with no outgoing calls
 */

export interface TrackEvent {
  eventName: string;
  userId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Tracks an analytics event. This is a leaf node — it makes no calls to other services.
 */
export function track(event: TrackEvent): void {
  // Leaf node: no outgoing calls to other services
  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({ ...event, timestamp });
  // In production this would send to an analytics backend
  process.stdout.write(`[Analytics] ${payload}\n`);
}

/**
 * Formats a TrackEvent as a JSON string. Arrow function to test const-export extraction.
 */
export const formatEvent = (event: TrackEvent): string => {
  return JSON.stringify(event);
};
