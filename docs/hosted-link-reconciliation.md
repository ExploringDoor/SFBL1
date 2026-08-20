# Money in flight from the retired Square payment link

The hosted Square payment link is retired. Before it was, it could take a
payment and leave no record on our side, so a small number of teams may have
paid and still show as unpaid. This is how the office finds them.

Island: there is almost certainly nothing to find. Zero Island registrations
ever had a link minted for them. Do step 1 and step 3 anyway. They take two
minutes and they close the question.

COYBL: there are three to check, and one of them is recent.

## 1. Get the list

Ask Adam to run, for your league:

    SA_PATH=<your service account json> LEAGUE=<island|coybl> \
      npx tsx scripts/reconcile-hosted-links.ts

It prints three things. UNRESOLVED is the worklist. CHECK ANYWAY is teams that
settled another way after a link was minted, where the risk is that they paid
twice. The third list is every payment we already know about.

## 2. Look each one up in Square

Square Dashboard, Payments, Transactions. Set the date range to start on the
day of the earliest link in the list. The script prints times in UTC, so a link
shown at 00:44 UTC is the evening before in Ohio and New York. Widen the range
by a day at each end rather than trusting the boundary.

Every link still outstanding was minted before the 20 August 2026 rename, so on
COYBL they all read:

    COYBL 2027 Registration: <team name>

A payment that came through the registration form on the site shows a lowercase
note instead, `coybl registration: <team>` or `island registration: <team>`, and
is already recorded. Those need nothing.

So: any transaction in that window whose description starts with a capitalised
"... Registration:" is a payment we did not record.

## 3. Delete the links that are still out there

Square Dashboard, Online, Checkout links. A payment link does not expire on its
own unless an expiry was set on it, and none was, so treat every one ever minted
as payable today. Delete any named `COYBL 2027 Registration: ...`. If a coach
pays one next week it will not be recorded either, because the code that would
have recorded it is gone.

On Island, expect to find none. If you find one, tell Adam, because it means
something we believe about this is wrong.

## 4. Record what you found

For each payment you matched to a team, open Admin, Payments, and enter it on
that team's row: amount paid, method Card, and Save. That is what clears them
off the reminder list.

For anyone in the CHECK ANYWAY list who turns out to have paid twice, refund the
card payment in Square. Square does not return the processing fee on a refund,
so a refunded $438.81 leaves the league roughly $13 down. Confirm the figure in
the dashboard before you tell the coach anything, then refund it anyway. It is
their money.

## Why this is manual

The retired route never stored the payment link id or the order id it created,
so there is nothing in our database to join to a Square transaction. The only
trace is a timestamp and an amount. That is exactly the gap the embedded card
form does not have: every payment it takes writes a square_payment_id and a
receipt url onto the team's ledger row the moment the card clears.