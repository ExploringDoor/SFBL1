# COYBL pre-season audit, 11 September 2026

Full sweep before the 2027 season opens. 26 teams registered, 13 umpires,
$3,843 collected.

Checked: every public page, all 11 form kinds, the payment ledger against
Square, captain access, rosters, PII exposure, page weight, email delivery on
all 37 real submissions, and admin tenant gating.

---

## Blockers. The season cannot run until these are done

**1. There is no schedule. Zero games.**
`leagues/coybl/games` is empty. Doug's own coaches email says league tournament
pairings happen the first week of June and games run 21 to 24 June 2027, so
there is time, but nothing exists yet. Standings are empty for the same reason.

**2. 25 of 26 teams have no division.** Only Marysville Marlins has one.
The public Teams page prints **"Division TBD" 24 times**. Doug's email says
divisions get built from the Power Rankings as a starting point, so this is
expected work, not a fault, but it is the most visible unfinished thing on the
site and every visitor sees it.

**3. All 88 roster players are sitting unapproved.**
Every player a coach has added carries `walk_on: true`, which flags them for
admin review. Nobody has approved any of them. They are spread across 9 of 26
teams. The **Approve all** button on the Signups tab clears the queue in one
click; Doug may not know it is there.

---

## Money

**$8,390 outstanding across 18 unpaid teams.** $3,843.05 collected from 8.

**Marysville Mitts, possible double payment. Still unresolved.**
Square shows Scott Beasley's card payment of **$511.09, completed 19 August,
not refunded**. That was recorded on the 20th. On **23 August at 23:03** someone
signed in with the admin password and overwrote the row with **$495 by Venmo**.
Either he paid twice and is owed $511.09 back, or the record was overwritten by
mistake. Only Doug's Venmo history settles it. Do not "correct" the ledger
before checking, because if there are two payments, tidying the record hides
the refund that is owed.

**A 50 dozen baseball order, $2,600, is unpaid and may be unknown.**
Rhonda Hare, 28 August, pickup rather than shipping. No payment recorded. The
submission carried no mail flags at all, because the three new forms were on
the unreliable fire-and-forget email path at the time. Fixed on 31 August, but
that particular order may never have reached Doug.

---

## Bugs found and fixed during this audit

**A typo'd reply-to was taking down the whole message.**
Umpire #11, Lawrence Henry, registered on 8 September as
`Lawrencefelixhrnry@yahoo. com`, with a space before the TLD. His confirmation
was undeliverable, which is correct. But the OFFICE copy, addressed to Doug at
a good address, failed too, because it carried the same broken string as its
reply-to and SendGrid rejects the entire send over that.

**Doug does not know that umpire registered.** Someone should contact Lawrence
Henry on 740-649-1579 and get a working address.

`to` had been validated since the beginning; `replyTo` never was, and it is the
field carrying whatever a stranger types into a public form. Tournament entries
and baseball orders set it the same way, so a coach with a fat-fingered address
would have silently hidden their own entry or order from the office. Guarded
now in both `sendEmail` and `sendGridOne`, with
`tests/email-reply-to-guard.test.ts` pinning it.

---

## Data quality, worth cleaning before the season

**Field names are messy and it shows publicly.** The Fields page derives 26
fields from registrations and renders them on a map, so these are all live:

* Two have an ADDRESS in the name box, and render duplicated:
  `755 Rathmell Rd, Columbus, OH 43207, Columbus 43207` and
  `23353 OH-37, Marysville Oh 43040`
* Near-duplicates that are the same place:
  `Bevelhymer Park` / `Bevelhymer Park New Albany`,
  `Lou Berliner Park` / `Lou Berliner Sports Park`,
  `UCJRD` / `UCJRD Marysville, Ohio`,
  `Peachblow Crossing Elementary` / `Peechblow` (misspelt),
  `Past Time Park, Pony Field` / `Pastime Park, Kaiser Field` (two spellings)

**Two teams share an identical name.** Worthington Christian Warriors **9U**
(Nate Hillery) and **11U** (Caleb Stertzer). Both legitimate, same church
program, different age groups. But with no age in the name they are
indistinguishable in standings, dropdowns and game assignment. Every other
multi-team club puts the age in the name.

**7 teams have no logo:** Big Walnut 7u-Johnstone, Ohio Independence 14U,
Olentangy Stix 7U, Plain City Pioneers 13u Red, Plain City Pioneers Cortez 12U,
UAJBA McBride, Worthington Nationals Red 8U.

**One umpire's email will bounce silently.** Christopher Carloni registered as
`chriscarloni@yahoo.vom` — "vom", not "com". Valid syntax so it was accepted,
but the domain does not exist. He will never receive anything.

---

## Healthy, verified

* **Every public page returns 200** and loads fast. 16 pages checked.
* **No PII leaks.** The only addresses on public pages are Doug's own
  check-payable address and the age directors' published contact details, both
  intentional. No coach home addresses, phones, emails or sign-in codes anywhere.
* **26 of 26 teams have a sign-in code.** Head and assistant coaches both get it
  by email at registration; the code belongs to the team, so any number of
  coaches can share it.
* **The spam defence works, proven in production.** On 29 August a bot hit four
  different forms in eighteen minutes. All five submissions were quarantined and
  **`office_email_sent: false` on every one**. Doug received nothing.
* **Umpire registration is being used for real:** 13 umpires, numbers 1 to 13,
  since 3 September. The per-season numbering is holding.
* **36 of 37 real submissions delivered their email.** The one failure is
  Lawrence Henry above.
* **Zero errors** logged.

---

## Performance

Nothing urgent, but two pages are heavy:

| Page | Size | Time |
|---|---|---|
| `/history` | 873 KB | 1.8 s |
| `/rules` | 478 KB | 1.3 s |
| everything else | under 180 KB | under 1.1 s |

---

## Still open from earlier

* Doug's **2027 dates and fees** for both tournaments. Those two pages are built
  and hidden, still showing last season's numbers behind a "being confirmed"
  notice. They cannot be released until he sends 2027 figures.
* The baseball order page went public on 10 September at his request.
