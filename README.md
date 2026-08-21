<div align="center">

# signit

**Sign a PDF without sending it anywhere.**

Draw a signature, put it on the page, download the signed file. It all happens in the tab — there is no upload, because there is no server.

**[Use it →](https://bleakmidwinter90.github.io/signit/)**

[![CI](https://github.com/BleakMidwinter90/signit/actions/workflows/ci.yml/badge.svg)](https://github.com/BleakMidwinter90/signit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)

</div>

---

## Why this exists

The documents people need to sign are tenancy agreements, employment contracts, bank mandates and passport scans. The ordinary way to sign one is to upload it to a free website, which is precisely the wrong thing to do with all four.

signit does it in the browser. The file is opened in the tab, the signature is written into it in the tab, and the result is saved from the tab.

## What it does

**Draws a signature** with a finger, a stylus, a mouse or a trackpad. The strokes are kept as points rather than pixels for as long as possible, then rendered at roughly eight times the size they will be placed at, so the result stays crisp when the page is printed.

**Puts it where you click**, on any page, as many times as you need. Drag to nudge it.

**Flattens it into the page.** The signature becomes page content, not an annotation — an annotation can be moved or deleted by whoever opens the file, and a signature the recipient can drag off is not a signature.

**Handles rotated pages.** This is the part most browser signing tools get wrong, and it is worth explaining.

## The rotated page problem

A PDF page can carry a `/Rotate` of 90, 180 or 270. Phone scans and office copiers produce them constantly. The page is stored unrotated and the *viewer* turns it, so screen coordinates and file coordinates disagree — on top of PDF already measuring y upwards from the bottom while screens measure it downwards from the top.

Get it wrong and a signature dropped at the bottom of the page lands on a side edge, lying on its side. The sender finds out after the contract has gone.

The coordinate maths has unit tests, but they only prove it is *self-consistent* — that it round-trips, and that four screen corners stay four distinct page corners. A convention that was internally consistent and backwards would pass every one of them.

So there are two scripts that check it against a real renderer:

```sh
npm run verify:rotation   # a mark placed at each /Rotate lands where it should
npm run verify:stamp      # and it is upright, and not mirrored
```

`verify:stamp` uses a deliberately asymmetric mark — a wide bar with a black square in one corner — and checks three separate things: that it is positioned correctly, that it is wider than it is tall so it has not been turned, and that the square is still in its corner so it has not been flipped.

That script reported three of the four rotations broken on the first run, while every unit test passed. The bug was that cancelling a viewer's clockwise turn needs a counter-clockwise turn of the *same* size, not the complement — `360 - rotation` positions the signature perfectly and lays it on its side.

Both scripts need macOS `qlmanage` to render, which is why they are run by hand rather than in CI.

## Try it

```sh
git clone https://github.com/BleakMidwinter90/signit.git
cd signit
npm install
npm run dev
```

`npm run build` produces a `dist/` you can host anywhere. Serve it over HTTP rather than opening `index.html` directly — the PDF renderer uses a worker, and browsers refuse to load those from `file://`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Static production build |
| `npm test` | Unit tests |
| `npm run lint` | Lint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run smoke` | Builds, then drives it in a real browser |
| `npm run verify:rotation` | Checks placement against a renderer (macOS) |
| `npm run verify:stamp` | Checks stamps land upright (macOS) |

## How it works

- [`placement.ts`](src/lib/placement.ts) — screen coordinates to PDF user space, at every rotation
- [`strokes.ts`](src/lib/strokes.ts) — capture, simplify and smooth a drawn signature
- [`pdf.ts`](src/lib/pdf.ts) — read a document and write marks into it
- [`viewer.ts`](src/lib/viewer.ts) — render pages with pdf.js

Two things that cost time and are worth knowing:

**pdf.js takes ownership of the buffer it is given** and detaches it, which leaves the same `ArrayBuffer` unusable for the pdf-lib pass that writes the signature. The file opens and displays perfectly and only saving breaks. The bytes are copied before viewing.

**pdf.js silently falls back to the main thread** when its worker cannot be loaded. The rendered pixels are identical, so no check on the output can tell the difference. The smoke test asserts a dedicated worker was actually spawned.

## What it is not

This is not a digital signature in the cryptographic sense. It draws your signature onto the page, the same as signing a printout and scanning it — which is what almost every "e-signature" service is doing too, underneath the audit trail. If you need a certificate-backed signature that proves the document has not been altered since, you need different software, and this says so rather than implying otherwise.

## License

[MIT](LICENSE).
