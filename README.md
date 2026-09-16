# OMR Magic

A quiet, reviewable way to grade photographed answer sheets — built as a
fully static, installable PWA. No Node.js, no build step, no backend.
Open `index.html` (or deploy the folder as-is) and it works.

> **`index.html` is fully self-contained.** All CSS and JavaScript are
> inlined directly into it, so the app renders and works correctly even
> if `styles/` or `scripts/` never make it into your deployment (a common
> issue when dragging a folder into GitHub's web upload UI, which
> sometimes drops subfolders silently). The `styles/` and `scripts/`
> folders are kept in this project as the readable, editable source —
> edit those files, then re-inline them (see "Editing the code" below)
> rather than editing the giant blocks inside `index.html` directly.

## Editing the code

If you change anything in `styles/*.css` or `scripts/*.js`, re-generate
the inlined copy so `index.html` stays in sync:

```bash
python3 - << 'EOF'
import re
html = open('index.html', encoding='utf-8').read()
css_files = ['styles/core.css', 'styles/glass.css', 'styles/scanner.css']
js_files = ['scripts/storage.js','scripts/question-parser.js','scripts/answer-key.js',
            'scripts/image-processing.js','scripts/omr-scanner.js','scripts/grading.js','scripts/app.js']
css_blob = "\n\n".join(open(f, encoding='utf-8').read() for f in css_files)
js_blob = "\n\n".join(open(f, encoding='utf-8').read() for f in js_files)
html = re.sub(r'<style>.*?</style>\n', f'<style>\n{css_blob}\n</style>\n', html, flags=re.S)
html = re.sub(r'<script>.*?</script>\n</body>', f'<script>\n{js_blob}\n</script>\n</body>', html, flags=re.S)
open('index.html', 'w', encoding='utf-8').write(html)
EOF
```

## Deploying without surprises

Whichever way you push this to GitHub Pages, only `index.html` (plus
optionally `manifest.webmanifest`, `service-worker.js`, and `icons/` for
installability) needs to actually arrive in the repo for the app to
render and work correctly:

- **Easiest / least error-prone:** use `git` from a terminal
  (`git add -A && git commit -m "deploy" && git push`) rather than the
  GitHub website's drag-and-drop uploader — it always preserves folder
  structure.
- **Using the website uploader:** drag the *contents* of `OMR-Magic/`
  (not the `OMR-Magic` folder itself) into the upload box, and confirm
  `styles/` and `scripts/` appear as folders in the repo afterward before
  assuming a code bug.

## Workflow

```
Home → Answer Key → Scan OMR → Live Check → Result
```

1. **Home** — start a test, or reopen a recent one.
2. **Answer Key** — set question count, options per question, marks, and
   negative marking. Fill in the correct answer for every question and
   approve the key. You can also download a printable answer sheet
   template that matches the key exactly (see below).
3. **Scan OMR** — point the rear camera at a filled sheet. A glass frame
   guides alignment; the app auto-captures once all four corner markers
   are steadily in view, or you can capture manually or choose a photo.
4. **Live Check** — answers reveal question by question as they're
   scored against the key, with a running progress count.
5. **Result** — final score, percentage, and a full breakdown. Tap any
   wrong or unclear answer to correct it by hand — corrections re-grade
   instantly.

## Why a printable template?

Real optical-mark recognition needs to know exactly where every bubble
is. Rather than guessing at an arbitrary sheet layout, OMR Magic
generates the sheet: `answer-key.js` draws a printable template with
four solid corner markers and a bubble grid computed from
`SheetLayout.computeLayout()`. The scanner uses that same layout
function to know precisely where to look, so the printed sheet and the
scanner are always in agreement. Hand the downloaded template to
students, or drop it into your own paper.

## Recognition pipeline

```
Image → Detect sheet (corner markers) → Correct perspective (homography)
      → Detect bubbles (per-question sampling) → Analyze marks (darkness)
      → Confidence scoring → Answers
```

The computer-vision code is isolated from the UI:

| Module | Responsibility |
|---|---|
| `scripts/image-processing.js` | Grayscale conversion, corner-marker detection, homography solve, perspective warp, brightness/contrast quality checks |
| `scripts/omr-scanner.js` | Per-bubble darkness sampling, blank/answered/multiple classification, confidence scoring, duplicate-sheet hashing, pipeline orchestration |
| `scripts/answer-key.js` | Sheet layout geometry (`SheetLayout`) shared by the template renderer and the scanner, plus answer-key state helpers |
| `scripts/grading.js` | Pure scoring functions: key comparison, negative marking, manual-correction re-grading |
| `scripts/question-parser.js` | Question-paper upload handling; a real, working ingestion path with a clearly-labeled placeholder for a future AI answer-suggestion step (it never fabricates an answer today) |
| `scripts/storage.js` | `localStorage`-backed persistence for tests, answer keys, and per-student results |
| `scripts/app.js` | Screen routing and all UI wiring |

**Nothing is ever invented.** If the four corner markers can't be found,
the scanner reports an error and asks for a retake rather than guessing
a layout. If a bubble isn't dark enough to call, the question is
reported as unanswered; if two bubbles are similarly dark, it's reported
as multiple. Low-confidence answers surface as "? Unclear" for the
teacher to resolve.

## Features

- Auto-capture when the sheet is aligned, with a live alignment meter
- Scan-quality warnings (dark, overexposed, low-contrast photos)
- Teacher correction mode on the results screen
- Negative marking, configurable per test
- Duplicate-sheet detection via a perceptual hash of the corrected scan
- Test history with per-test class averages
- Fully offline after first load (service worker + app-shell cache)

## Project structure

```
OMR-Magic/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── README.md
├── styles/
│   ├── core.css        # layout, typography, screens
│   ├── glass.css        # liquid-glass surfaces + bubble background
│   └── scanner.css      # camera scanning interface
├── scripts/
│   ├── app.js
│   ├── omr-scanner.js
│   ├── image-processing.js
│   ├── answer-key.js
│   ├── grading.js
│   ├── question-parser.js
│   └── storage.js
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

## Running locally

Any static file server works, e.g.:

```bash
cd OMR-Magic
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly via `file://` will work for most of the UI,
but browsers block camera access on `file://`, so use a local server (or
GitHub Pages) to test scanning.

## Deploying to GitHub Pages

1. Push this folder's contents to the root of a GitHub repository (or to
   a `docs/` folder, or a `gh-pages` branch — whichever you point Pages at).
2. In the repo's **Settings → Pages**, set the source to that
   branch/folder.
3. Visit the published URL on a phone and use **Add to Home Screen** (iOS
   Safari) or the install prompt (Android Chrome) to install it as an app.

No environment variables, no build command, no dependencies to install.

## Browser support notes

- Camera scanning requires `getUserMedia`, which needs HTTPS (GitHub
  Pages provides this) or `localhost`.
- If camera access is denied or unavailable, the scanner falls back to
  **Choose photo** automatically.
- Data (tests, keys, results) is stored per-browser in `localStorage`.
  Clearing site data clears test history.
