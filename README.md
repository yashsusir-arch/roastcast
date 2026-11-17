# RoastCast — offline coffee roast profile simulator

Enter green-bean data and RoastCast gives you a target roast profile:
- colour change, first crack, development time and DTR, drop, weight loss and RoR
- a chart of the curve
- export to Kaffelogic (`.kpro`), CSV and JSON

It is a Progressive Web App (PWA). Host it free on GitHub Pages, install it on Android from Chrome, and it then works with no internet.

## Files

| File | What it does |
|---|---|
| `index.html` | Input page + results page |
| `styles.css` | Blue / yellow / black / green theme, Futura Bold font stack |
| `model.js` | The roast model and the Kaffelogic / CSV export |
| `app.js` | UI: form, validation, saved batches, chart, downloads |
| `sw.js` | Service worker that caches everything for offline use |
| `manifest.webmanifest`, `icons/` | Lets Android install it as an app |
| `.nojekyll` | Tells GitHub Pages to serve files as-is |

## Put it on GitHub Pages

1. Create a new **public** repository on github.com, e.g. `roastcast`.
   (GitHub Pages on private repos needs a paid plan.)
2. Upload the *contents* of this folder to the repository root. Either drag them into **Add file → Upload files**, or use git:
   ```bash
   git init && git add . && git commit -m "RoastCast v1"
   git branch -M main
   git remote add origin https://github.com/<you>/roastcast.git
   git push -u origin main
   ```
3. In the repository, go to **Settings → Pages**. Set **Source** to "Deploy from a branch", then choose `main` and `/ (root)`, and save.
4. After a minute the app is live at `https://<you>.github.io/roastcast/`.

## Install on Android

1. Open the GitHub Pages URL in **Chrome** on the phone, while online.
2. Tap **⋮ → Add to Home screen → Install**. You may instead see an "Install app" banner.
3. Open RoastCast from the home screen once. Everything, including the font, is now cached and it works in airplane mode.

## Updating the app

Edit files and push. Then **bump `VERSION` in `sw.js`** (e.g. `roastcast-v2`). Without that, phones keep serving the old cached copy. Open the app twice while online to pick up the update.

## Font

Futura is a commercial font, so it isn't bundled. The app uses Futura Bold if the device has it. Otherwise it falls back to **Jost**, a free Futura-style font that gets cached for offline use. If you own a Futura Bold webfont licence, add the file as `fonts/Futura-Bold.woff2` and it is used automatically. Also add `./fonts/Futura-Bold.woff2` to `ASSETS` in `sw.js`.

## Kaffelogic export: read this

Kaffelogic does not publish the `.kpro` file format. What we know:
- Profiles are plain-text `key:value` lines.
- The roast curve is a Bezier spline in seconds and °C.

The key names and point ordering in this app are a best guess. To get a file the roaster accepts:
1. In Kaffelogic Studio, open a profile you already use, e.g. a core profile, and save a copy.
2. In RoastCast's export panel, load that file as the **Base profile**. RoastCast keeps all its settings: fan curve, zones, roast levels, preheat and so on. It replaces only the roast curve, expected colour change and first crack, the recommended level, and the name and description.
3. Open the result in **Kaffelogic Studio first** and check the curve looks right before loading it onto the roaster.

If the curve looks scrambled, try the other **Curve encoding** options. Better still, share a sample `.kpro` so the format can be fixed for good.

## The model, briefly

This is a rules-of-thumb model, not a physics simulation. It turns density, moisture, elevation, crop age, origin, process and screen size into a "hardness" score. That score shifts:
- drying time and colour-change temperature
- Maillard length
- first-crack temperature
- development ratio, drop temperature and weight loss

The target roast level sets the base DTR, the rise after first crack, and weight loss. The curve uses a rate of rise that falls in straight lines between milestones, so it never "flicks". Calibrate it against your own roast logs.
