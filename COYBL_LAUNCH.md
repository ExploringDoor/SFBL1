# COYBL Launch Checklist

Running list of what's left before the COYBL site goes live for Doug Hare.
Site: https://coybl-preview.vercel.app · Vercel project: `coybl-preview` ·
Firebase (shared): `sfbl-acf51`.

## Config switch-ons (no building — just settings)

- [ ] **Verify `coybl.org` in Resend** — add 3 DNS records (SPF / DKIM / DMARC)
      to coybl.org's DNS. Comes with Doug handing over the domain.
- [ ] **Set email env vars on the `coybl-preview` Vercel project** — once the
      domain is verified:
      - `RESEND_API_KEY` = key from resend.com
      - `EMAIL_FROM` = `COYBL <noreply@coybl.org>`
      - `EMAIL_NOTIFY` = league-office inbox that gets a ping on each new registration
      > Until these are set, a coach who registers gets an account created but
      > no set-password email. Once set, the branded coybl.org email flows
      > automatically. Isolated to this project — cannot touch SFBL.
- [ ] **`ANTHROPIC_API_KEY`** on `coybl-preview` — turns on AI game recaps
      (falls back to a template recap without it).
- [ ] **Point `coybl.org` (or a subdomain) at the `coybl-preview` Vercel project**
      — Doug controls DNS.

## Confirm with Doug

- [ ] **Pricing** — site currently shows Option 1 $495 / Option 2 $425 / USSSA
      +$35. Doug's 6/18 numbers were $495 / $425 / +$40 USSSA. Confirm the $35.
- [ ] **Team binding** — after a coach registers, a director assigns the team to
      a division and binds the coach (captain claim) via admin tools. Confirm who
      does this and walk Doug through it.

## Already done

- [x] Real data seeded — 196 teams / 30 divisions / 974 games from coybl.org
- [x] Admin password set (`COYBL_ADMIN_PASSWORD`)
- [x] Firebase service account wired (`FIREBASE_SERVICE_ACCOUNT_JSON`)
- [x] Coach login (email + password) + account-creation-on-registration + Venmo/fee copy
- [x] Manager/Coach Help page, Alerts signup page, coach logo upload

## Nice-to-have / deferred

- [ ] Text (SMS) alerts need Twilio — email alerts work via the Resend path above
- [ ] Power-rankings editor login (CSV upload) — deferred per Adam
- [ ] Registration *confirmation* email copy is SFBL-hardcoded (affects other
      tenants only; COYBL's coach email is already branded) — make tenant-aware
