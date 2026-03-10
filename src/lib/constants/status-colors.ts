/**
 * Shared status → className mappings for Badge components.
 * Used by event-selector, events list, overview, and anywhere
 * an event or deal status needs consistent color coding.
 */

export const EVENT_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export const DEAL_STATUS_COLORS: Record<string, string> = {
  funded: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  unwound: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

export function eventStatusColor(status: string): string {
  return EVENT_STATUS_COLORS[status] ?? "";
}

export function dealStatusColor(status: string): string {
  return DEAL_STATUS_COLORS[status] ?? "";
}
