# Hosting the privacy policy

Google requires a **publicly reachable URL** for the privacy policy, even though
this extension stores everything locally and uploads nothing:

> "Extensions are required to disclose how they handle user data, even when data
> is processed or stored locally on a user's device and is not transmitted to
> external servers or third parties."

`PRIVACY.md` at the repo root is the text. Any of these works — pick one and
paste the resulting URL into the dashboard's Privacy tab.

## Public gist (quickest)

1. gist.github.com → new **public** gist named `PRIVACY.md`
2. Paste the contents of `PRIVACY.md`, create it
3. Use the gist's URL

Takes a minute. The URL is ugly but entirely valid.

## GitHub Pages (tidiest)

1. Push this project to a public GitHub repo
2. Settings → Pages → deploy from `main`, root
3. Use `https://<user>.github.io/<repo>/PRIVACY` (rename to `privacy.md` at the
   repo root, or move it to `docs/`)

## What not to do

Don't link a Google Doc, a Dropbox share, or anything behind a sign-in — reviewers
reject policy URLs they can't open anonymously. Check it in a private window
before submitting.
