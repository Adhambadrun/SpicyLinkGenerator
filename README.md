# Spicy Link Generator

A single-page web tool that turns a GDS (Sabre/Amadeus) itinerary into booking-ready links and BookWithMatrix-valid JSON — entirely in the browser. Nothing is uploaded; all parsing happens locally on the visitor's device.

Made by Lamar García · lamar@bcflights.com

## Features

- **Paste → auto-parse** — the itinerary parses automatically as you paste, edit, or press Enter.
- **Leg confirmation** — shows every parsed segment (carrier, flight, class, route, date, times) plus a class check, and warns loudly if any line is not recognized.
- **Generate Link** — opens AA.com metasearch with all flights pre-selected.
- **Copy JSON / Download JSON** — BookWithMatrix-valid JSON (ITA "Copy itinerary as JSON" schema).
- **Alternative airlines link generator** — direct checkout links for Delta and Alaska.
- **Report bug** — opens a Gmail draft to lamar@bcflights.com with your input, output, and unrecognized lines included.

Currently supporting American Airlines, Delta Airlines, and Alaska Airlines.
Updates and bug fixes are applied automatically.

## Local test

Just open `index.html` in any browser (double-click it). No build step, no dependencies.

## Deploy to Vercel (free)

1. Push this folder to GitHub (see below).
2. Go to **https://vercel.com** → **Add New → Project**.
3. Import the repository.
4. Vercel detects a static site automatically — keep the defaults:
   - Framework Preset: **Other**
   - Build Command: *(leave empty)*
   - Output Directory: *(leave empty)*
5. Click **Deploy**. You get a `https://your-name.vercel.app` URL instantly.

To update later: push to GitHub — Vercel redeploys automatically.

## Pushing to GitHub (one-time)

```bash
cd spicy-link-generator
git init
git add .
git commit -m "Initial commit — Spicy Link Generator"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/spicy-link-generator.git
git push -u origin main
```

## Files

- `index.html` — the entire app (self-contained: HTML + CSS + JS + logo inline)
- `vercel.json` — static hosting config (clean URLs)
