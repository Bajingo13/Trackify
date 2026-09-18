# Trackify — Privacy Policy

**DRAFT. Not yet published, and not yet reviewed by counsel.**

Google Play will not accept an app that requests background location without a
publicly reachable privacy policy URL, so this is the hard blocker on submitting
Trackify Driver. It is drafted here from what the system verifiably does, so the
remaining work is a review and a decision on the placeholders below — not
writing it from nothing.

Everything marked **`[CONFIRM]`** needs the operator's own answer. Nothing in
this file should be published until those are filled and a lawyer has read it.

Each statement below was checked against the code rather than written from how
such systems usually work. Where a claim could not be supported, it was removed
rather than softened — see the note at the end.

---

## Before publishing

| Item | Needed from |
|---|---|
| **`[CONFIRM]`** Retention period for driver location records | The operator's records policy |
| **`[CONFIRM]`** Contact address for privacy requests | The operator (the DPO address below is AstreaBlue's) |
| **`[CONFIRM]`** Which phone number is correct — `02-5310-0423` or `02-5310-0243` | The two differ by two transposed digits in the Terms of Service |
| **`[CONFIRM]`** How drivers give consent | A driver who uses only the mobile app cannot accept the Terms of Service — there is no code path for it. Either a driver-side acceptance step is built, or counsel confirms another legal basis for employed drivers. See the note at the end. |
| A public URL to host this at | Must resolve without a login, or Play rejects it |

---

## 1. Who this covers

This policy covers **Trackify** (the web system used by dispatch and office
staff) and **Trackify Driver** (the mobile application used by employed
drivers).

Trackify is operated by **AstreaBlue Intelligence Inc.**, Makati, Philippines,
on behalf of client trucking companies ("the operator"). Accounts are issued by
an operator to its own employees. There is no public sign-up, and the
applications are not offered to consumers.

## 2. What is collected

**Everyone with an account**

- Name, email address
- Role and company or branch affiliation
- The record of your acceptance of the Terms of Service: which version, when,
  and the IP address and browser identification it was accepted from
- An audit trail of administrative, master-data, fleet, warehouse, finance and
  Driver App actions, recording who acted and from which IP address, kept for
  BIR compliance

Sign-in events themselves are **not** recorded — there is no sign-in log, and no
record of the device or browser you signed in from.

**Drivers, additionally**

- **Precise location** — latitude, longitude, speed, heading and accuracy
- Employee number, licence number, licence type and expiry, mobile number
- Emergency contact name, number and relationship
- A profile photograph, if the driver adds one
- Photographs the driver captures as proof of delivery, and expense receipts

## 3. Location, specifically

This is the part Google asks about, and the part a driver most deserves a
straight answer on.

- Location is recorded **only while a trip is released or in transit**.
- Recording starts **only when the driver switches on "Share my location"**. The
  app offers that switch once dispatch has released the trip. Nothing is
  recorded before the driver turns it on.
- It **continues while the app is in the background and the phone is locked.**
  This is necessary because a driver cannot hold or watch a phone while
  operating a truck, and the position matters for exactly that period.
- While recording, the app shows a **permanent notification** stating that the
  position is being shared. It cannot record silently.
- A driver can **stop sharing at any time** from the trip screen. Recording also
  stops when the delivery is confirmed, or when the trip moves to any other
  status — the server refuses location data for a trip that is not released or
  in transit.
- **Nothing is recorded outside that window.** Not between trips, not off
  shift, not on rest days.

## 4. Why it is collected

- To show the dispatch office where a vehicle carrying a load is
- To give customers an accurate arrival estimate
- To establish a record of a delivery where one is later disputed
- To keep accounts secure and to maintain the audit trail Philippine tax rules
  require

Location is **not** used for advertising, **not** used to score or rank drivers
outside the trip record, and **not** sold.

## 5. Who it is shared with

- **The employing operator's own dispatch and administrative staff.** A
  driver's location is visible to the company they work for.
- **Service providers** under confidentiality obligations, for hosting.
- **The public OpenStreetMap Nominatim geocoding service.** Addresses typed into
  the system — trip origins, destinations and stops — are sent there to be
  turned into map coordinates. It is a public service operating under its own
  terms rather than a confidentiality agreement with AstreaBlue. Nothing
  identifying a user or a driver is sent with the address.
- **Government authorities**, including the Bureau of Internal Revenue, where
  legally required.

It is not shared with anyone else, and it is not sold to anyone.

## 6. How long it is kept

Account records are kept while the account is active, and afterwards for the
period Philippine tax and accounting law requires.

Driver location records are kept as part of the trip record they belong to.
**`[CONFIRM]`** — the operator must state the period here; "as long as the trip
record" is only an answer once the trip retention period is itself stated.

## 7. How it is protected

- Passwords and driver PINs are stored hashed, never in readable form
- Access is controlled by role, and scoped to a company and branch
- Repeated failed sign-in attempts are blocked, counted both per account and
  per network address
- Administrative, master-data, fleet, warehouse, finance and Driver App actions
  are written to an audit trail; every change to a trip's status is recorded in
  that trip's own history with the user who made it. The audit trail covers
  those actions rather than every action in the system
- Traffic is encrypted in transit

Two-factor authentication is **not** offered.

## 8. Rights under the Data Privacy Act

Under Republic Act No. 10173 you may ask to be informed about, access, correct,
object to, or have erased or blocked the personal data held about you; to have
it provided in a portable form; and to complain to the National Privacy
Commission.

Some data cannot be erased on request where tax law requires it to be retained.
Where that applies, the reason will be given.

**To exercise any of these:** **`[CONFIRM]`** contact address.

Data Protection Officer: `admin@astreablue.com` / **`[CONFIRM]`** phone.

## 9. Changes

Material changes are published with a new version number and effective date.
Users are asked to accept the revised Terms of Service and Data Privacy Policy
inside the system before continuing to use it.

---

## A note on what this deliberately does not say

**Drivers cannot currently accept the Terms of Service, and the system has no
way to let them.** The acceptance routes sit behind the staff authentication
middleware, which rejects a Driver App token outright; the `drivers` table has
no link to a user account to record an acceptance against; and the driver app is
mounted outside the acceptance gate. So the Terms offer consent-by-acceptance as
a legal basis for collecting driver location from the one group with no way to
give it.

That is a gap in the system, not in the wording, and it is the open item on this
document. Resolving it means either building a driver-side acceptance step or
having counsel confirm a different basis for employed drivers. Until then this
policy does not claim drivers have consented.

The earlier discrepancy on two-factor authentication — the Terms declared it
mandatory in three places while nothing implemented it — was resolved in version
1.2 of the Terms, which states plainly that it is not offered. A backend test
now checks each factual claim in the Terms against the code that implements it,
so a claim like that cannot be reintroduced without the suite failing.
