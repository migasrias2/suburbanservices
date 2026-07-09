# Geofenced Clock-In Plan

A proposal to replace the clock-in / clock-out QR codes with one-tap GPS-verified clock-in, while keeping the existing QR system for area-level scans inside buildings.

## Goal

Cleaners tap a button on their phone — the app reads their GPS once, checks it against the customer's site geofence, and clocks them in. Clock-out works the same way. Indoor room tracking continues to use QR codes because GPS isn't accurate enough indoors.

## Why this is worth doing

- **Faster clock-in** — one tap vs. point camera → focus → scan.
- **Better fraud story** — every clock-in has GPS proof. Combined with the room-level QR scans, this is a stronger audit trail than either alone.
- **Less physical infrastructure** — no more clock-in QR posters to maintain at every site entrance.
- **Sales differentiator** — most UK cleaning ops platforms don't verify clock-ins by geofence. Saying "every shift is GPS-verified" is a credibility win with clients.

## What stays the same

- Area / task QR codes inside buildings (Reception, Men's Ablution, etc.) — GPS can't distinguish rooms.
- The existing photo / task workflow.
- Manager + admin dashboards.

## What changes

- `/clock-in` page → new geofenced clock-in screen (no camera).
- Clock-in / clock-out QR codes become dead code (can be removed after a fallback period).
- New site coordinates stored per customer.

---

## Cleaner experience

### Clock in
1. Opens app → big "Clock in" button on home.
2. Taps it → phone prompts for location → user allows.
3. App grabs one GPS reading (~1 second).
4. Backend checks if the reading falls inside any of the cleaner's assigned site geofences.
5. **Match** → "Clocked in at Avtrade · 09:02" + green check.
   **No match** → "You don't seem to be at a site. Move closer to the entrance and try again."
   **Multiple matches** (rare) → site picker.
6. Row written to `time_attendance` with `clock_in`, `cleaner_uuid`, `customer_name`, GPS coords.

### During the shift
- Home shows "On shift at Avtrade · 1h 12m".
- Single tile: "Scan area".
- Cleaner walks to a room → scans the QR sticker → task workflow opens.
- Completes tasks, uploads photos, finalizes → back to home → next room.

### Clock out
- Taps "Clock out".
- App re-reads GPS, verifies still inside the geofence.
- `time_attendance.clock_out` set.

### Optional nudge
- If cleaner's location strays outside the geofence by >2× radius for >10 minutes, surface a "Looks like you left Avtrade. Clock out?" banner.

---

## Admin experience

In the New Client wizard (or a new "Site Locations" screen), the admin pins each site on a map and picks a radius.

| Field | Example |
| --- | --- |
| Site | Avtrade HQ |
| Latitude | 51.234 |
| Longitude | -0.456 |
| Radius (m) | 80 |

Recommended radius: **50–100m** for typical sites. Larger industrial sites: **150–200m**.

---

## Data model

### Option A — single building per customer (simple)
Add columns to `uk_customers`:

```sql
ALTER TABLE public.uk_customers
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN geofence_radius_m integer DEFAULT 80;
```

### Option B — multi-building per customer (better long-term)
New table `customer_sites` (one customer → many sites):

```sql
CREATE TABLE public.customer_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.uk_customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  geofence_radius_m integer NOT NULL DEFAULT 80,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

Recommendation: start with **Option A** for speed, migrate to Option B when the first multi-building customer signs up.

### `time_attendance` changes
Already has `clock_in_lat`/`clock_in_lng` etc. (need to confirm — if not, add them). Existing GPS capture in `QRScanner.tsx` can be reused.

---

## Code work

| File / module | What |
| --- | --- |
| Migration | Add lat/lng/radius columns (Option A) or new `customer_sites` table (Option B) |
| `src/services/geofenceService.ts` | `findSiteByLocation(lat, lng, scopedCustomerIds[])` — runs Haversine, returns matched site or null |
| `src/services/attendanceService.ts` | Add `clockInByLocation(cleanerId, coords)` and `clockOutByLocation(cleanerId, coords)` |
| `src/components/clockin/ClockInGeo.tsx` | New "tap to clock in" UI — replaces QR scanner on `/clock-in` |
| `src/pages/ClockInPage.tsx` | Swap QRScanner → ClockInGeo |
| `src/components/dashboard/CleanerDashboard.tsx` | "On shift" / "Off shift" state, "Scan area" tile |
| Admin site-pin UI | New step in New Client wizard or dedicated `/admin/sites` page with map picker |

### Approx effort
- ~4–5 days of focused work, given the 9 site coordinates are gathered.
- +1 day if going with the multi-building model from the start.

---

## Decisions to lock in before building

| Decision | Default |
| --- | --- |
| Default radius | **80 m** |
| Location permission denied | **Hard block** — no clock-in possible (defeats the purpose otherwise) |
| Site has no geofence configured yet | **Allow clock-in, flag row as `geo_unverified`** so admin can audit |
| Customer has multiple buildings | Treat as separate sites under one customer, picker if ambiguous |
| Keep clock-in QR fallback during rollout | **Yes** — 30-day fallback, then remove |
| Single building model vs. multi-building from day one | **Single building** (Option A) for speed |

---

## Edge cases

| Edge | Handling |
| --- | --- |
| Permission denied | "Location needed to clock in" + link to settings. No silent fallback. |
| GPS reading too imprecise (`accuracy > 100m`) | Retry once, then "Move outside / to a window" |
| Cleaner at geofence boundary | Anything within radius counts as "inside". Don't overthink. |
| Leaves for lunch and comes back | Existing clock-in stays open; only manual clock-out closes it. |
| Cleaner phone has no GPS at all | Manager-assisted manual clock-in (admin override) |
| Spoofed GPS | Acceptable risk — combined with room-level QR scans it's still hard to fake a full shift |

---

## Non-code prerequisite

A **GDPR consent screen** on first login:

> "We use your location to verify clock-in at customer sites. Coordinates are stored alongside your shift record and used only for attendance verification. Tap Continue to agree."

Without informed consent, location collection at scale is a UK legal risk. Stub copy can be added during build; final wording should go past whoever owns the data policy.

---

## What this does NOT solve

- **Auto clock-in / auto clock-out** (phone enters geofence → automatic). That requires reliable background geolocation, which web browsers (especially iOS Safari) don't allow once the app is backgrounded or the phone is locked. The realistic path to that experience is a thin native shell (Capacitor or React Native wrapping this codebase) — a separate 4–6 week project.
- **Indoor positioning**. GPS accuracy indoors is 30–100m, nowhere near enough to distinguish rooms within a building. That's why area/task QR codes (or NFC tags as a future upgrade) stay.

---

## Suggested rollout

1. **Week 1** — data model migration, geofence service, admin pin-on-map screen.
2. **Week 2** — gather site coordinates with the admin tool, build the cleaner-facing `ClockInGeo` screen, ship behind a feature flag for one customer (Avtrade).
3. **Week 3** — soft launch for all customers with the QR-code fallback still active.
4. **Week 4** — monitor `geo_unverified` rows, fix gaps, retire the clock-in QR codes.
