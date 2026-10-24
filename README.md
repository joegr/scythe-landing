# Scythe landing page

A static page on GitHub Pages that collects emails and lets a visitor try cutting a card. It reuses the type and card styles from `scythe-web/frontend/src/index.css`.

| Path | What it is |
| --- | --- |
| `site/` | The page: plain HTML, CSS and JS, no build step. GitHub Pages serves this folder. |
| `site/demo.js` | The "Try it" demo: fetches a Wikipedia article (or any page that allows cross-origin reads, or pasted text), cuts a card of at most 100 words snapped to whole words, marks it with keys 1–3, shows the read-aloud version and copies it for Word. It runs only in the browser and sends nothing to Scythe. |
| `relay/` | A small Node server on Fly.io. It holds a GitHub token and writes each signup into the private repo `joegr/scythe-signups`. |
| `.github/workflows/pages.yml` | Deploys `site/` on every push to `main` that touches it. |

This repo is public, so it contains no secrets and no emails. A static page can't keep a secret, so the token lives only in Fly's secret store and the relay is the only thing that uses it.

## Preview locally

```bash
python3 -m http.server 8137 -d site
```

## How signups are stored

Each signup becomes `signups/<sha256(email)>.json` in `joegr/scythe-signups`:

```json
{ "email": "you@school.edu", "source": "utm_source=reddit", "created_at": "2026-10-15T23:40:00.000Z" }
```

Because the file is named after the hashed email, a repeat signup tries to create a file that already exists. It's treated as a success, so there are no duplicates. `source` keeps only the `utm_*` tags from the page's link; anything else on it is dropped, so the email is the only personal data stored. The relay lowercases emails, ignores submissions that fill the hidden honeypot field, allows 5 requests per IP per minute, accepts only the origins listed in `relay/fly.toml` (kept out of the repo: `*.toml` is ignored, so the relay's Fly config lives only on the machine that deploys it), and answers the same way for new and repeat emails.

To export the list:

```bash
gh repo clone joegr/scythe-signups && jq -r '[.email, .created_at] | @csv' scythe-signups/signups/*.json > signups.csv
```

## Deploy the relay

Create a fine-grained personal access token (GitHub → Settings → Developer settings → Fine-grained tokens) with access to **only** `joegr/scythe-signups` and the single permission **Contents: read and write**. Then:

```bash
cd relay
fly secrets set GITHUB_TOKEN=<token>
fly deploy
```

The relay scales to zero when idle, so the first signup after a quiet period takes a second or two.

## Deploy the page

Pages is set to build from GitHub Actions. Every push to `main` that touches `site/` redeploys it to https://joegr.github.io/scythe-landing/.
