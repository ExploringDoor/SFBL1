# COYBL Launch Checklist

Running list of what's left before the COYBL site goes live for Doug Hare.
Live domain: **https://coybl.net** · Vercel project: `coybl-preview` ·
Firebase (shared): `sfbl-acf51`.

## Config switch-ons (no building — just settings)

- [ ] **Verify `coybl.net` in Resend** — add 3 DNS records (SPF / DKIM / DMARC).
      DNS for coybl.net is now managed IN Vercel (nameservers point there), so
      **Adam can add these records himself** — no need to involve Doug.
- [ ] **Set email env vars on the `coybl-preview` Vercel project** — once the
      domain is verified:
      - `RESEND_API_KEY` = key from resend.com
      - `EMAIL_FROM` = `COYBL <noreply@coybl.net>`
      - `EMAIL_NOTIFY` = league-office inbox that gets a ping on each new registration
      > Until these are set, a coach who registers gets an account created but
      > no set-password email. Once set, the branded coybl.net email flows
      > automatically. Isolated to this project — cannot touch SFBL.
- [ ] **`ANTHROPIC_API_KEY`** on `coybl-preview` — turns on AI game recaps
      (falls back to a template recap without it).

## Confirm with Doug

- [ ] **Pricing** — site currently shows Option 1 $495 / Option 2 $425 / USSSA
      +$35. Doug's 6/18 numbers were $495 / $425 / +$40 USSSA. Confirm the $35.
- [ ] **Team binding** — after a coach registers, a director assigns the team to
      a division and binds the coach (captain claim) via admin tools. Confirm who
      does this and walk Doug through it.

## Already done

- [x] **Custom domain LIVE — https://coybl.net** (+ www, http→https redirect,
      valid auto-renewing SSL). Nameservers point at Vercel; Adam manages DNS.
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
