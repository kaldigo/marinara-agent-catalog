/** World State uses a readable comma-separated hierarchy; Maps keeps its own path display. */
export function formatWorldStateLocation(breadcrumb: readonly { name: string }[]): string {
  return breadcrumb.map(location => location.name).join(", ");
}
