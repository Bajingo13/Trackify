import navigation, { filterNavigation } from "../../data/navigationConfig";

/**
 * Pages the signed-in user may open that match what they typed. Matches the
 * page name or its group ("finance" finds every finance page); an empty query
 * lists them all so the palette doubles as a menu.
 */
export function searchPages(query, can, tree = navigation) {
  const q = query.trim().toLowerCase();
  const pages = [];
  for (const group of filterNavigation(tree, can)) {
    const leaves = group.children || [group];
    for (const leaf of leaves) {
      const label = leaf.label;
      const where = group.children ? group.label : "";
      if (!q || label.toLowerCase().includes(q) || where.toLowerCase().includes(q)) {
        pages.push({ id: `page:${leaf.path}`, kind: "page", label, hint: where, path: leaf.path });
      }
    }
  }
  return pages;
}

/** Trips become results that open that trip on the Trips page. */
export function tripResult(trip) {
  return {
    id: `trip:${trip.id}`,
    kind: "trip",
    label: trip.ticketNo,
    hint: [trip.customer, trip.origin && trip.destination ? `${trip.origin} → ${trip.destination}` : ""]
      .filter((v) => v && v !== "—").join(" · "),
    path: `/operations/trips?trip=${encodeURIComponent(trip.id)}`,
  };
}
