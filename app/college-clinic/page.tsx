// College Clinic registration — 12 October 2026. Venue not published.
//
// Mike ran this off a flyer with "REGISTER AT ISLANDFASTPITCH.COM" printed on
// it and nothing behind it (via Adam, 2026-08-18). This is that page.
//
// ONE PLAYER PER SUBMISSION, $175 each, 40 places. Everything else on this
// site registers a TEAM, so this is the first form where the payer is a
// parent and the fee is per head. The clinic_registration kind exists for
// exactly that reason: a separate bucket, its own required fields, and its
// own price in lib/fees.
//
// Grad year and high school are asked because the point of the day is college
// coaches watching. Those are the first two things a recruiter wants and the
// two a 14 year old will not think to volunteer.
//
// Island only. The clinic is one league's event and the details below are
// hardcoded rather than config-driven; a second tenant running a clinic is
// the moment to move this into Firestore, not before.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LeagueForm, type FormField } from "@/components/forms/LeagueForm";
import { getAdminDb } from "@/lib/firebase-admin";
import { CLINIC, clinicIsOver } from "@/lib/clinic";
import { paidClinicPlaces } from "@/lib/clinic-count";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "College Clinic",
  description:
    "Island Fastpitch College Clinic, October 12 2026. Ten college programs in attendance. Open to 14U, 16U and 18U.",
};

const AGE_GROUPS = [
  { value: "14U", label: "14U" },
  { value: "16U", label: "16U" },
  { value: "18U", label: "18U" },
];

// Wide enough for a 2027 senior through a 2032 eighth grader. Generated so it
// cannot drift out of date the way a hardcoded list does.
const GRAD_YEARS = Array.from({ length: 7 }, (_, i) => {
  const y = String(CLINIC.year + i);
  return { value: y, label: y };
});

const POSITIONS = [
  { value: "P", label: "Pitcher" },
  { value: "C", label: "Catcher" },
  { value: "1B", label: "First Base" },
  { value: "2B", label: "Second Base" },
  { value: "3B", label: "Third Base" },
  { value: "SS", label: "Shortstop" },
  { value: "LF", label: "Left Field" },
  { value: "CF", label: "Center Field" },
  { value: "RF", label: "Right Field" },
  { value: "UTIL", label: "Utility" },
];

const FIELDS: FormField[] = [
  { name: "player_first_name", label: "Player first name", type: "text", required: true, width: "half" },
  { name: "player_last_name", label: "Player last name", type: "text", required: true, width: "half" },
  { name: "age_group", label: "Age group", type: "select", required: true, options: AGE_GROUPS, width: "half" },
  {
    name: "grad_year",
    label: "High school graduation year",
    type: "select",
    required: true,
    options: GRAD_YEARS,
    help: "College coaches sort by this first.",
    width: "half",
  },
  { name: "primary_position", label: "Primary position", type: "select", required: true, options: POSITIONS, width: "half" },
  { name: "secondary_position", label: "Secondary position", type: "select", options: POSITIONS, width: "half" },
  { name: "high_school", label: "High school", type: "text", width: "half" },
  { name: "current_team", label: "Current travel team", type: "text", width: "half" },
  { name: "parent_first_name", label: "Parent or guardian first name", type: "text", required: true, width: "half" },
  { name: "parent_last_name", label: "Parent or guardian last name", type: "text", required: true, width: "half" },
  {
    name: "email",
    label: "Email",
    type: "email",
    required: true,
    help: "Where the confirmation and receipt go.",
    width: "half",
  },
  { name: "phone", label: "Phone", type: "tel", required: true, width: "half" },
  {
    name: "notes",
    label: "Anything the staff should know",
    type: "textarea",
    help: "Injuries, allergies, arriving late, whatever matters.",
  },
  {
    name: "agreed_to_terms",
    label:
      "I confirm the details above are correct and I understand the clinic fee is non-refundable once the player's place is confirmed.",
    type: "checkbox",
    required: true,
  },
];

/** Places already sold. The filter itself lives in lib/clinic-count so the
 *  page, the intake API and the card charge cannot drift into three different
 *  answers to one question. */
async function placesTaken(tenantId: string): Promise<number> {
  try {
    return await paidClinicPlaces(getAdminDb(), tenantId);
  } catch {
    // A count is a nicety. If Firestore is unhappy, show the form rather than
    // an error page: a registration we can take is worth more than a number.
    return 0;
  }
}

export default async function CollegeClinicPage() {
  const tenantId = headers().get("x-tenant-id");
  if (tenantId !== "island") notFound();

  // AFTER 2 PM ON 12 OCTOBER the form comes down. Not the page: an old link, a
  // printed flyer and a search result all still land here, and they should land
  // on an explanation rather than a 404. What comes down is the ability to
  // register and be charged $175 plus surcharge for an event that has already
  // happened, which this page would otherwise have gone on offering forever.
  const over = clinicIsOver();
  const taken = over ? 0 : await placesTaken(tenantId);
  const left = Math.max(0, CLINIC.capacity - taken);
  const full = left === 0;

  return (
    <>
      <section className="le-clinic-hero">
        <div className="container le-clinic-hero-inner">
          <p className="le-clinic-eyebrow">Island Fastpitch</p>
          <h1 className="le-clinic-title font-display">College Clinic</h1>
          <ul className="le-clinic-facts">
            <li><strong>{CLINIC.dateLabel}</strong></li>
            <li>{CLINIC.timeLabel}</li>
            <li>Open to {CLINIC.ages}</li>
            <li><strong>${CLINIC.fee}</strong> per player</li>
            <li>{CLINIC.capacity} player max</li>
          </ul>
          {/* Venue removed 2026-08-23. Deliberately renders NOTHING rather
              than "Location TBA": the clinic is eight weeks out and a promise
              to announce something is a promise somebody then has to keep.
              Families who ask get told by the office. See lib/clinic.ts. */}
        </div>
      </section>

      <section className="container le-clinic-colleges">
        <h2 className="le-clinic-h2">Colleges in attendance</h2>
        <ul className="le-clinic-college-list">
          {CLINIC.colleges.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="le-clinic-note">
          Attendance is as confirmed at the time of printing. Questions about
          the day: Mike on{" "}
          <a href={`tel:${CLINIC.phone.replace(/\D/g, "")}`}>{CLINIC.phone}</a>.
        </p>
      </section>

      {over ? (
        <section className="container le-clinic-full">
          <h2 className="le-clinic-h2">This clinic has finished</h2>
          <p>
            The College Clinic on {CLINIC.dateLabel} has already taken place, so
            registration is closed. Call Mike on{" "}
            <a href={`tel:${CLINIC.phone.replace(/\D/g, "")}`}>{CLINIC.phone}</a>{" "}
            to hear about the next one.
          </p>
        </section>
      ) : full ? (
        <section className="container le-clinic-full">
          <h2 className="le-clinic-h2">This clinic is full</h2>
          <p>
            All {CLINIC.capacity} places are taken. Call Mike on{" "}
            <a href={`tel:${CLINIC.phone.replace(/\D/g, "")}`}>{CLINIC.phone}</a>{" "}
            to go on the waiting list, in case of a drop out.
          </p>
        </section>
      ) : (
        <LeagueForm
          kind="clinic_registration"
          title="Register a player"
          // "40 of 40 places left" parses as a fraction and reads wrong when
          // the clinic is empty, which is exactly when it is first seen.
          eyebrow={`${left} places left of ${CLINIC.capacity}`}
          intro={[
            <>
              One form per player. The fee is <strong>${CLINIC.fee}</strong> and
              a place is held once it is paid, which you can do on the next
              screen.
            </>,
            <>
              Bring a glove, bat, helmet, cleats and water. Wear your travel
              team uniform if you have one.
            </>,
          ]}
          fields={FIELDS}
          submitLabel="Continue to payment"
          successMessage={`Thanks! ${CLINIC.playerNoun} is registered for the College Clinic on ${CLINIC.dateLabel}. Pay below to confirm the place.`}
          afterSuccess="payment"
          leagueId={tenantId}
        />
      )}
    </>
  );
}
