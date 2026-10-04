# haazir

Single-page marketing site for **haazir** — a Jaipur studio building WhatsApp AI
agents for premium Indian businesses. React + Tailwind, no backend: every call
to action is a `wa.me` link.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview
```

## Layout

```
src/
  App.jsx                  section order
  index.css                design tokens, grid/marquee/slider styles, reduced-motion rules
  lib/
    site.js                number, email, and the pre-filled WhatsApp openers  <- edit before launch
    segments.js            the outreach variants (/jewellers, /clinics, ...)   <- your copy lives here
    campaign.js            reads the segment + ?ref= tag out of the URL, once
    images.js              photography + alt text          <- edit before launch
    format.js              Indian number formatting (lakh / crore, 2-2-3 commas)
    hooks.js               reduced motion, animated numbers, sticky-scroll activation
  components/
    Brand.jsx              jharokha mark, wordmark, buttons (all SVG, no image files)
    Thread.jsx             plays a scripted thread out inside a phone, message by message
    Hero.jsx               headline + the thread: the demo IS the hero
    SegmentBar.jsx         one-line "built for", replacing the six-photo marquee
    Reveal.jsx             fades a block up as it enters view
    ScrollProgress.jsx     the 2px reading-progress rule at the top
    Nav.jsx  WhatItDoes.jsx  Calculator.jsx  HowItWorks.jsx
    Pricing.jsx  Faq.jsx  CallToAction.jsx  Footer.jsx
scripts/
  og.mjs                   renders the link-preview cards into public/ (run by hand)
  icons.mjs                renders the home-screen icons into public/ (run by hand)
  pages.mjs                post-build: one static page per segment, own meta tags
public/
  manifest.webmanifest     makes the site installable on a phone
  sw.js                    offline fallback; network-first so it cannot pin stale HTML
```

## Before launch

1. **`src/lib/site.js`** — replace `91XXXXXXXXXX` with the real WhatsApp
   Business number, and set the contact email. Every CTA reads from this one
   file. `SITE_URL` there, and the hardcoded domain in `index.html` +
   `scripts/pages.mjs`, need the real domain once you have one — they are what
   the link-preview card points at.
2. **Calculator assumptions** — `AFTER_HOURS_SHARE` (34%) and `RECOVERY_RATE`
   (12%) live at the top of `Calculator.jsx` and are printed under the sliders.
   Change the constants and the copy updates itself.

## Design rules this codebase holds to

- The page is light (`#F7F7F4` alternating with `#FFFFFF`, `#F1EFE9` "stone" for
  recessed panels) with dark **forest** (`#123A2F`) used deliberately for the
  moments that should land: the calculator result, the featured price, the
  closing call to action and the footer. No other dark surfaces.
- Terracotta is an accent only: buttons, one word in the hero headline, icon
  strokes, the step numbers. Never a background wash.
- Two terracotta shades, for contrast rather than decoration: `#D2603F` for
  large type, icon strokes and glows; `#A8482B` (`clay-deep`) for filled buttons
  and any terracotta text under 24px. `#D2603F` only reaches 3.6:1 on off-white,
  so it fails WCAG AA at body sizes; `#A8482B` clears it at 5.4:1. On forest,
  small text is `paper` at 75% or more, and `clay-soft` is for large figures
  only.
- Type is Schibsted Grotesk (variable) + Noto Sans Devanagari, **self-hosted**
  through `@fontsource` and imported in `main.jsx`, so there is no third-party
  font request and no flash of fallback type. Headlines: weight 600, `-0.04em`
  tracking, 0.95-1.05 leading. Body 17px/1.65. No `tabular-nums` on currency:
  Schibsted draws the comma too wide with it on.
- Section labels are a small sentence-case pill (`SectionLabel`), not an
  uppercase eyebrow. Buttons come in two tones: `PrimaryCTA` (terracotta) and
  `tone="light"` for use on forest.
- Every section that describes the product carries a small static picture of it
  (the slot picker, the three languages, the hand-over), drawn in JSX from the
  same tokens. They are `aria-hidden`: the paragraph beside them says it all.
- Nothing animates under `prefers-reduced-motion: reduce`: the counters snap,
  scrolling is not smoothed.
- No fake testimonials, client logos or statistics anywhere on the page. "Built
  for" names customer *segments*, not clients.
- Every run of text on the page clears WCAG AA against its actually-painted
  backdrop (composite each ancestor background; remember Tailwind v4 reports
  colours as `oklch()`/`color-mix()`, so normalise through a canvas first).
- **Motion is restrained and has to earn its place.** Still banned: glassmorphism
  (translucent-plus-blur) anywhere, grain/noise texture, ambient glow behind
  every panel, and anything that floats or breathes on a loop. The one
  terracotta glow is top-left of the hero; the phone sits on a flat stone panel.
  What motion there is: a short fade-up as sections enter view (`Reveal`, 14px
  and 600ms — the page settling, not an effect), a reading-progress rule, and
  the conversation playing itself out inside the phone.
  Every one of them is off under `prefers-reduced-motion`, and none of them
  gate content — a visitor who never sees an animation still reads the whole
  page.

## Interaction that stayed

- **Sticky nav**, transparent until the page has scrolled (`useScrolled` in
  `lib/hooks.js`), then a solid white bar with a border and a resting shadow
  — no blur. A real mobile menu: hamburger → slide-down panel, closes on
  Escape/resize/link-click, locks body scroll while open. `Nav` is rendered
  at the `App.jsx` level, not inside `Hero` — `Hero` uses `overflow-hidden`
  for its grid/glow, which would otherwise clip the nav's stickiness the
  moment you scrolled past it.
- **`PrimaryCTA`'s base classes force `inline-flex` unconditionally.** A call
  site that tries to override it with `hidden sm:inline-flex` is stacking a
  second, unconditional `display` utility on the same element — cascade
  order (not JSX order) decides which wins, so that override is not
  reliable. Where a `PrimaryCTA` needs to be hidden/shown responsively (the
  desktop-only nav button), wrap it in `<div className="hidden sm:block">`
  instead of passing display utilities through `className`.

## The outreach kit

This site is an outbound asset: it gets pasted into a WhatsApp chat or opened
in front of someone at their counter. Everything below exists for that, not for
search traffic.

- **Link previews.** `index.html` carries the full og:/twitter: set, and
  `public/og*.png` are the cards themselves. Without these, a pasted link shows
  as bare text and reads as spam — which is the single cheapest way to lose a
  cold prospect. Regenerate the cards with `npm run og` after a wording or
  brand change (needs `npm i -D playwright-core`; it is deliberately not a
  default dependency, since the PNGs are committed).
- **One page per segment.** `/jewellers`, `/clinics`, `/hotels`, `/coaching`.
  Each is a real file in `dist/`, written by `scripts/pages.mjs` after the
  Vite build, carrying its own title, description and og:image — a crawler
  never runs the JS, so client-side routing would make every link preview
  identically. The bundle is shared; `lib/campaign.js` reads the path at
  runtime and swaps the subhead, the sample conversation, which photo the
  strip leads with, and what the calculator opens tuned to. Add or edit
  variants in `lib/segments.js` — no other file needs touching.
- **Every CTA opens a started conversation.** `whatsappLink(context)` in
  `lib/site.js` pre-fills the message, worded per button and per segment, so
  the prospect never lands in an empty thread: the pricing button asks about
  Build + Run, the closing one leaves the cursor after "here's an enquiry we
  missed:", the calculator one carries the figure.
- **`?ref=` tags the outreach round.** `haazir.example/jewellers?ref=johari-1`
  appends `(ref: johari-1)` to whatever the prospect sends you, so replies are
  attributable to a batch without any analytics. Stripped to word characters
  and 40 chars, since it ends up visible in someone's message.
- **A shareable calculator.** The sliders write to `?e=` and `?t=`, and "Copy
  link with these numbers" hands you a URL that opens on the prospect's own
  figures. Dial in their enquiry volume and ticket size, send the link, let
  the page make the argument. The URL stays clean until a slider actually
  moves, so an untouched outreach link is not cluttered.
- **An FAQ that pre-empts the DM round-trips** — the ban question, the
  number-migration question, the "what if it says something wrong" question.
  Eight of them, in `Faq.jsx`.

Segment calculator defaults (`lib/segments.js`) are deliberately conservative.
The model multiplies up quickly, and an opening figure that reads as hype costs
more trust than a big number buys attention.

## Motion, and how it fails safe

`Reveal` starts its children at `opacity-0`, which is the one pattern here that
could actually hide content, so it is worth knowing how it cannot:

- `useInView` sets itself to visible when there is no `IntersectionObserver` at
  all, rather than waiting for a callback that will never come.
- The observer latches — once seen, always visible — so nothing flickers back
  out on the way past.
- Its threshold is `0` with a negative bottom `rootMargin`, not a fraction. A
  section taller than the viewport can never show "15% of itself", so a
  fractional threshold makes tall sections (the comparison table, the FAQ)
  reveal late or not at all. The margin does the delaying instead, and behaves
  the same at any height.
- Under `prefers-reduced-motion` the transition collapses to nothing, so the
  content appears instantly instead of animating.

`Conversation` plays on a chain of timers. Under reduced motion it skips
straight to the full thread — the exchange is the content, the timing is
decoration — and the timers are cleared on unmount so a replay can never race a
run that is already going.

## Installing it on a phone

This repo builds a **website**, not an Android package. There is no `build.gradle`,
no `AndroidManifest.xml`, no Capacitor or Cordova, and `npm run build` cannot
emit an `.apk`. If you see Android's *"App not installed as package appears to
be invalid"*, it came from some other tool that wrapped the site — not from
this code.

What it does support is installing straight from the browser, which needs no
package, no signing key and no store listing:

- **Android (Chrome):** open the site → ⋮ → *Add to Home screen* / *Install app*.
- **iPhone (Safari):** open the site → Share → *Add to Home Screen*.

It then opens fullscreen with the jharokha icon and no browser bar, and it
still opens with no signal — handy when you are showing it to someone inside a
showroom with two bars.

Regenerate the icons with `node scripts/icons.mjs` if the mark ever changes
(needs `npm i -D playwright-core`; the PNGs are committed so a normal install
never needs a browser).

### Why the service worker is written the way it is

A worker that serves HTML from cache can pin a stale page on someone's phone
permanently — worse than having no worker at all. So `public/sw.js` is
network-first for navigations and only ever caches them as an offline fallback.
`/assets/*` is content-hashed by Vite, so those filenames never change meaning
and are the one thing served cache-first. Everything else, including Google
Fonts, is left alone. There is a test for exactly this: change the built HTML
with the worker already installed, reload, and the new HTML must win.

Bump `VERSION` in `sw.js` to evict every cache on the next visit.

### If you genuinely need a real `.apk`

Two honest routes, both more work than the above:

1. **Trusted Web Activity** (Bubblewrap) — a thin Android shell around this
   exact site. Needs a Play Console account, a signing key, and a
   `.well-known/assetlinks.json` on the domain to prove you own it.
2. **Capacitor** — wraps the built `dist/` into a native project you compile in
   Android Studio. Heavier, and only worth it if you later want camera,
   push or contacts.

Neither is a five-minute job, and neither is worth doing before the site has a
real domain and a real WhatsApp number on it.

## Why the page is shaped this way

It was rebuilt around one measurement. The previous version ran **12,607px on a
phone — 14.9 screens of scrolling** — across eleven sections, and the single
most persuasive thing on it, the conversation playing itself out, sat fourth.
A jeweller reading mid-shift was never going to reach it, let alone the price.

The rebuild:

- **The demo is the hero.** `Thread` moved into `Hero`, so the exchange plays
  the moment you land. On a phone the blocks run headline → thread → buttons
  rather than headline → buttons → thread: proof before the ask, and it lifts
  the card ~300px so it is properly on screen instead of peeking over the fold
  by an inch. That is why the hero uses explicit grid placement rather than two
  nested columns — the desktop order and the phone order genuinely differ.
- **The photo strip became one line.** Six stock photos cost a section to say
  something `SegmentBar` says in 165px, and every one of them was an unverified
  Unsplash placeholder. With the hero photo gone too, the page now carries **no
  photography at all** — which also retired `Photo.jsx`, `lib/images.js` and the
  whole dead-URL failure mode. If you want photography back once you have
  licensed shots, it is an additive change, not a rescue.
- **The sticky how-it-works is now three columns.** Pinning the heading and
  dimming each step cost 2,169px of desktop scrolling to deliver three short
  paragraphs. The paragraphs were the point.
- **The comparison table became two paragraphs inside pricing.** Seven rows that
  had to scroll sideways on a phone were answering two objections — so they are
  now two answers, sitting next to the price where the objection actually
  surfaces.
- **The bento became three equal cards**, with compliance as the strip
  underneath. It is a reassurance, not a fourth feature.

Result: **desktop 10,236px → 6,087px (11.4 → 6.8 screens, 41% shorter)**, phone
12,607px → 9,189px. Eleven sections became seven.

Deleted in the process, and why nothing references them: `Marquee.jsx`,
`Conversation.jsx` (became `Thread.jsx` in the hero), `Comparison.jsx`,
`Photo.jsx`, `lib/images.js`, plus the `useParallax` and `useActiveInViewport`
hooks that only existed to drive the hero photo and the sticky scroller.
