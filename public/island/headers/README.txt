ISLAND FASTPITCH — page header banner images
=============================================

Drop .jpg files in THIS folder, named exactly by page slug:

    home.jpg               the homepage banner
    scores.jpg
    schedule.jpg
    standings.jpg
    teams.jpg
    tournaments.jpg
    rules.jpg
    fields.jpg
    team-registration.jpg

You do NOT need all of them. Any slug without a file simply shows no banner.

Wide and short works best, roughly 1600x400 or the same 1983x793 shape as the
banners already made. They are shown full width across the top of the page.

AFTER dropping files in, tell Claude, because the slug list is registered in
lib/header-images.ts. It is a static list on purpose: an fs scan works locally
but returns nothing on Vercel, which silently deletes every banner on the live
site.

The league LOGO is separate from these. That goes in theme.logo_url in
scripts/seed-island.ts and shows in the nav and ticker.
