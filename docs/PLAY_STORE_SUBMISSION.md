# Play Store submission — Trackify Driver

Google rejects an app that requests `ACCESS_BACKGROUND_LOCATION` without a
written justification and a demo video. Both are review requirements, not
paperwork to do afterwards, so they are drafted here rather than written under
time pressure on the day of submission.

Nothing in this file is a code change. It is the text and the shot list.

---

## 1. What the app is

**Trackify Driver** is the driver-side companion to Trackify, a trip-ticket
management system used by a Philippine trucking operator. A driver signs in with
their employee number and a PIN, sees the runs assigned to them, records arrival
at each stop, confirms delivery with a receiver name and photograph, and files
fuel and toll receipts from the road.

It is distributed to the operator's own employed drivers. It is not a consumer
app and there is no public sign-up.

---

## 2. Background location justification

Paste this into the Play Console declaration. Keep it in the operator's own
voice and do not shorten it into a slogan — reviewers reject vague answers.

> Trackify Driver records the location of a commercial delivery vehicle while a
> trip ticket is in progress, so the dispatch office can see where the load is
> and give the customer an accurate arrival time.
>
> The location is recorded only between the moment the driver taps **Start
> trip** and the moment the delivery is confirmed. Outside that window the app
> records nothing at all.
>
> Background access is required because a driver cannot hold the phone or keep
> the screen on while driving a truck. The phone is in a cradle or a pocket with
> the screen locked for the whole run, which is exactly when the position
> matters. Foreground-only access would leave a gap covering almost the entire
> journey and would make the feature useless for its purpose.
>
> While a trip is recording, a permanent notification is shown that names the
> app and states that the position is being shared with dispatch. The driver can
> stop sharing at any time from the trip screen.
>
> The location is sent only to the operator's own Trackify server. It is not
> sold, not shared with any third party, and not used for advertising.

**Answers to the declaration form**

| Question | Answer |
| --- | --- |
| Which feature needs background location? | Live trip tracking for the dispatch office |
| Is it visible to the user? | Yes — a permanent notification while recording, and an in-app toggle |
| Can the feature work with foreground-only access? | No — the screen is locked for nearly the whole journey |
| Is location shared with third parties? | No |
| Is location used for advertising? | No |

---

## 3. Demo video shot list

Google asks for a short, unlisted video showing the feature in use and the
permission being requested. Under two minutes is enough. Screen-record on the
handset; no narration is required, but on-screen captions help.

1. **Sign in** — employee number and PIN, landing on Today.
2. **Open an assigned trip** — show origin, destination and cargo.
3. **Tap Start trip.**
4. **Show the Android permission dialog appearing**, and choose **Allow all the
   time**. This is the shot the reviewer is looking for — do not cut it.
5. **Turn on Share my location** and show the trip screen reporting that the
   position is being sent.
6. **Lock the phone.** Pull down the notification shade and show the persistent
   "Trackify is recording this trip" notice.
7. **Cut to the dispatch web screen** showing the truck moving on the map.
   This is what demonstrates *why* the permission is needed.
8. **Return to the app and confirm delivery**, then show that the notification
   is gone and recording has stopped.

Upload as **unlisted** on YouTube and paste the link into the declaration.

---

## 4. Privacy policy

A publicly reachable privacy policy URL is mandatory for any app requesting
location. It must state, at minimum:

- that precise location is collected while a delivery trip is in progress
- that it is collected in the background with the screen locked
- who receives it (the employing operator's dispatch team)
- how long it is kept, and how a driver asks for it to be deleted
- a contact address

**Status: drafted and published by the application.** The public page is
`frontend/public/privacy-policy.html`; after the next frontend deployment its
production URL will be:

`https://trackify-frontend-production-7e1f.up.railway.app/privacy-policy.html`

Open that URL without signing in before entering it in Play Console. The policy
still needs counsel's approval before submission; publishing it is not legal
review.

---

## 5. Before the build is uploaded

| Item | State |
| --- | --- |
| Release signing keystore | **Not created.** `driver-app/android/keystore.properties` does not exist, so only debug builds are possible. `npm --prefix driver-app run release` fails with instructions. |
| Signed `.aab` | Blocked on the keystore above. |
| Android build toolchain | Driver web build and Capacitor sync pass. Native Gradle compile requires JDK 21; this workstation currently has JDK 25 only. |
| Background location justification | Drafted here. |
| Demo video | Shot list here; needs recording on a real handset. |
| Privacy policy URL | Page complete in source. Confirm the public production URL after deployment and obtain counsel review. |
| Data safety form | Declare: location collected, shared with no third party, not used for advertising, encrypted in transit, deletable on request. |

**On the keystore:** whoever creates it must keep both the file and its
passwords somewhere they cannot be lost. An Android app is identified by its
signing key for its entire life — lose the keystore and the app can never be
updated again under the same listing, only republished as a new one, and every
installed driver has to be migrated by hand.
