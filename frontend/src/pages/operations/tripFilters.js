/**
 * Barangay filtering for the trips list.
 *
 * Lifted out of the page's useMemo so it can be tested. Inside the component
 * these were unreachable — the only way to check them was to render the whole
 * Trips page, which needs a dozen services mocked, so in practice they were
 * taken on trust. They are the sort of thing that looks obviously right and
 * quietly is not: an optional field read two levels deep, and a comparison that
 * has to hold for trips created before the address columns existed.
 */

/**
 * Does this trip touch the given barangay, at either end?
 *
 * Either end on purpose: "what did we run to Sasa" and "what did we collect
 * from Sasa" are the same question asked from opposite directions, and a
 * dispatcher grouping a day's work does not care which way round it was.
 *
 * Compared exactly, matching the server, so the list and a scoped fetch cannot
 * disagree about what belongs in a barangay.
 */
export function matchesBarangay(trip, barangay) {
  if (!barangay || barangay === "all") return true;
  return (
    trip?.originAddress?.barangay === barangay ||
    trip?.destAddress?.barangay === barangay
  );
}

/**
 * Every barangay present across these trips, sorted for a select.
 *
 * Built from the data rather than from a fixed list because barangay names are
 * whatever the geocoder returned, and a hardcoded list would silently omit
 * anywhere new. Trips with no address contribute nothing, which is why an empty
 * result is the signal to hide the control entirely — offering a filter that
 * can only ever return nothing is worse than offering none.
 */
export function barangayOptions(trips = []) {
  const seen = new Set();
  for (const trip of trips) {
    if (trip?.originAddress?.barangay) seen.add(trip.originAddress.barangay);
    if (trip?.destAddress?.barangay) seen.add(trip.destAddress.barangay);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
