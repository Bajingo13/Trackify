/**
 * Frequently asked questions and troubleshooting guides for drivers.
 *
 * Written for someone reading it in a truck cab, with one hand and a bad
 * signal: short, in the order things should be done, and plain. Each entry may
 * carry `steps` (a guide to follow) and an `action` that takes the driver
 * straight to the right tool in Help & Support.
 *
 * It is content, not data: it ships with the app and works with no signal at
 * all, which is when it is most needed.
 */

export const FAQ_CATEGORIES = [
  { value: "delivery", label: "Deliveries" },
  { value: "vehicle", label: "Truck problems" },
  { value: "pause", label: "Pause requests" },
  { value: "safety", label: "Safety" },
  { value: "pay", label: "Pay and expenses" },
  { value: "app", label: "App and sign-in" },
];

/** What the button under an answer opens: a pause request, or a general request. */
export const FAQ_ACTIONS = {
  pause: "Request a pause",
  request: "Contact the office",
};

export const FAQ = [
  /* ---- deliveries ---- */
  {
    id: "start-trip", category: "delivery",
    q: "How do I start a delivery?",
    a: "A run opens under Today once the office releases it to you.",
    steps: [
      "Open Today and tap your run.",
      "Check the pickup, the stops and the cargo.",
      "Tap Start trip, and keep Share my location on so the office can follow you.",
    ],
  },
  {
    id: "reach-stop", category: "delivery",
    q: "What do I do when I reach a stop?",
    a: "Tell the app you have arrived, so the stop is stamped with the time and where you were.",
    steps: [
      "Open the route from the run (Open route).",
      "Tap the arrival button for the stop you are at.",
      "Carry on to the next stop when you are done.",
    ],
  },
  {
    id: "confirm-delivery", category: "delivery",
    q: "How do I confirm a delivery?",
    a: "Tap I've delivered at the drop-off and fill in who received the goods.",
    steps: [
      "Tap I've delivered.",
      "Take a photo of the goods or the signed slip.",
      "Enter the name of the person who received it, then confirm.",
    ],
  },
  {
    id: "nobody-there", category: "delivery",
    q: "Nobody is there to receive the delivery.",
    a: "Do not leave the cargo. Try to reach the customer, and tell the office.",
    steps: [
      "Tap the phone button at the top of the route screen to call the customer.",
      "Wait a reasonable time and take a photo of the place and the time.",
      "If you cannot reach anyone, send a request to the office with the photo.",
    ],
    action: "request",
  },
  {
    id: "wrong-address", category: "delivery",
    q: "The address is wrong or I cannot find it.",
    a: "Call the customer first. If they cannot guide you, let the office know.",
    steps: [
      "Call the customer from the route screen.",
      "Compare the pin on the map with what they tell you.",
      "If it still does not match, send the office a request. Say where you are.",
    ],
    action: "request",
  },
  {
    id: "no-deliver-button", category: "delivery",
    q: "I can't confirm the delivery.",
    a: "The app only lets a trip that is on the road be delivered.",
    steps: [
      "Check the trip says In transit. If it says Released, tap Start trip first.",
      "If you have no signal, confirm anyway. It is saved on your phone and sent later.",
      "Still stuck? Send the office a request with the trip number.",
    ],
    action: "request",
  },

  /* ---- truck problems ---- */
  {
    id: "breakdown", category: "vehicle",
    q: "My truck broke down.",
    a: "Get to safety first. Then ask the office to pause the delivery, so the stop is not read as inactivity.",
    steps: [
      "Turn on your hazard lights and move off the road if you can.",
      "Set out your warning device and stay clear of traffic.",
      "Take photos of the truck and where it stopped.",
      "Send a pause request: choose Vehicle breakdown and attach the photos.",
    ],
    action: "pause",
  },
  {
    id: "flat-tyre", category: "vehicle",
    q: "I have a flat tyre.",
    a: "Stop somewhere flat and safe. If you cannot change it yourself, ask for help.",
    steps: [
      "Park on firm, level ground with the hazards on.",
      "Photograph the tyre and the spot.",
      "If you cannot repair it, send a pause request (Vehicle breakdown) and wait for the office.",
    ],
    action: "pause",
  },
  {
    id: "overheating", category: "vehicle",
    q: "The engine is overheating or a warning light came on.",
    a: "Do not keep driving. Stopping early costs far less than a damaged engine.",
    steps: [
      "Pull over safely and switch the engine off.",
      "Do not open the radiator cap while hot.",
      "Photograph the dashboard, then send a pause request (Vehicle breakdown).",
    ],
    action: "pause",
  },
  {
    id: "accident", category: "vehicle",
    q: "I was in an accident.",
    a: "Your safety comes first. Call 911 if anyone is hurt, then tell the office.",
    steps: [
      "Check yourself and others. Call 911 if anyone is hurt.",
      "Turn on the hazards and do not move the truck unless it is unsafe where it is.",
      "Take photos of the scene, the damage and the other vehicle's plate.",
      "Send a pause request: Emergency if someone is hurt, otherwise Unexpected incident.",
    ],
    action: "pause",
  },

  /* ---- pause requests ---- */
  {
    id: "what-is-pause", category: "pause",
    q: "What is a pause request?",
    a: "It tells the office that something real is holding your delivery up. While it is approved, the delivery is shown as paused, with the reason, so a stop for a good reason is not read as inactivity.",
  },
  {
    id: "when-pause", category: "pause",
    q: "When should I ask for one?",
    a: "When something outside your control stops you from going on: a breakdown, an accident, an emergency, a closed or flooded road, a long unavoidable delay. It is not for breaks or personal errands.",
  },
  {
    id: "pause-how", category: "pause",
    q: "How do I send a pause request?",
    a: "From Help & Support, on a delivery that is on the road.",
    steps: [
      "Open Help & Support and tap Pause delivery (or Report a problem on your run).",
      "Choose what happened and describe it.",
      "Add photos so the office can see it. Emergencies do not need photos.",
      "Tap Send. The time is recorded when you send it.",
    ],
    action: "pause",
  },
  {
    id: "pause-after", category: "pause",
    q: "What happens after I send it?",
    a: "The office reviews it. You are told in the app when it is approved or declined, and you can follow it under Pause history. Once approved, the delivery shows as paused to the office and to your customer.",
  },
  {
    id: "pause-resume", category: "pause",
    q: "How do I carry on after a pause?",
    a: "Open the request in Help & Support (or your run) and tap Resume delivery when you are back on the road. The office is told straight away, and the customer's page updates.",
  },
  {
    id: "pause-declined", category: "pause",
    q: "My request was declined.",
    a: "Read the reason the office gave. In most cases you carry on with the delivery. If the problem is still real, reply in the same request and explain, or send a new one with more photos.",
  },
  {
    id: "pause-offline", category: "pause",
    q: "I have no signal. Can I still send one?",
    a: "Yes. It is saved on your phone with the photos and sent when you are back online. The time you pressed Send is the time recorded. Until then the office has not seen it, so if it is an emergency, call them.",
  },

  /* ---- safety ---- */
  {
    id: "emergency", category: "safety",
    q: "I am in an emergency.",
    a: "Call 911 first. When you are safe, tell the office.",
    steps: [
      "Call 911.",
      "Move to safety.",
      "Open Help & Support and tap Emergency. You do not need to take photos.",
    ],
    action: "pause",
  },
  {
    id: "unsafe-place", category: "safety",
    q: "I feel unsafe at a delivery location.",
    a: "You do not have to stay. Leave if you need to, and tell the office what happened and where.",
    action: "request",
  },

  /* ---- pay and expenses ---- */
  {
    id: "file-claim", category: "pay",
    q: "How do I claim an expense?",
    a: "File it against the run it belongs to, and attach the receipt.",
    steps: [
      "Open the run and tap + Expense (or use Claims, then Submit a claim).",
      "Choose the category and enter the amount and the date.",
      "Photograph the receipt and tap Submit claim.",
    ],
  },
  {
    id: "claim-rejected", category: "pay",
    q: "My claim was rejected.",
    a: "The reason is shown on the claim under Claims. Fix what it says and file it again, or reply to the office if you think it was a mistake.",
    action: "request",
  },
  {
    id: "lost-receipt", category: "pay",
    q: "I lost the receipt.",
    a: "File the claim without it and say why in the note. Finance decides. A photo of the pump or the toll plaza helps.",
  },

  /* ---- app and sign-in ---- */
  {
    id: "signin", category: "app",
    q: "I can't sign in, or I forgot my PIN.",
    a: "Your PIN can only be reset by the office. Contact them with your employee number.",
    action: "request",
  },
  {
    id: "gps", category: "app",
    q: "My location isn't updating.",
    a: "The office can only follow you while location sharing is on and the phone can get a fix.",
    steps: [
      "Turn on Share my location on your run.",
      "Check the phone's location setting is on and set to high accuracy.",
      "Turn off battery saver for this app, and keep it open if the phone is a browser.",
      "Move away from tunnels and tall buildings and wait a minute.",
    ],
    action: "request",
  },
  {
    id: "photos", category: "app",
    q: "Photos won't upload.",
    a: "They are not lost: the app keeps them on your phone and tries again.",
    steps: [
      "Check you have signal. A weak one is slow, not broken.",
      "Keep the app open for a moment. The banner at the top shows what is waiting.",
      "Retake a smaller photo if it still fails. The app shrinks them for you.",
    ],
  },
  {
    id: "offline", category: "app",
    q: "The app says I'm offline.",
    a: "You can carry on working. Arrivals, deliveries, expenses and requests are saved on your phone and sent automatically when the signal comes back.",
  },
  {
    id: "dark-mode", category: "app",
    q: "How do I change to dark mode?",
    a: "Open Profile, then use the Dark mode switch under Appearance.",
  },
];

const norm = (s) => String(s || "").toLowerCase();

/** The entries matching a search and/or a category. Searches the question, the answer and the steps. */
export function searchFaq({ query = "", category = "all" } = {}, items = FAQ) {
  const q = norm(query).trim();
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!q) return true;
    const hay = norm([item.q, item.a, ...(item.steps || [])].join(" "));
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}
