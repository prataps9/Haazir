/**
 * Renders the link-preview cards that WhatsApp, iMessage and LinkedIn show when
 * someone pastes a haazir link into a chat — one per outreach variant.
 *
 * Output lands in public/ and is committed, so a normal `npm install && npm run
 * build` never needs a browser. Re-run this only when the wording or the brand
 * changes:
 *
 *     npm i -D playwright-core          # once; not a default dependency
 *     node scripts/og.mjs
 *
 * PLAYWRIGHT_CHROMIUM can point at a Chromium binary if the default path is wrong.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { DEFAULT_SEGMENT, SEGMENTS } from '../src/lib/segments.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public')

const ARCH =
  'M26 86V58q6.7-4.4 4-12 7.5-3.8 6-12 7.8-3.5 7-12 7-1.8 7-9 0 7.2 7 9-.8 8.5 7 12-1.5 8.2 6 12-2.7 7.6 4 12v28H58v-8H42v8H26Z'

/** The card is plain inline CSS — it never ships to the browser, it becomes a PNG. */
function card(eyebrow) {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; background: #F7F7F4; color: #0E1013;
    font-family: 'Schibsted Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased; position: relative; overflow: hidden;
  }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(14,16,19,.055) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(14,16,19,.055) 1px, transparent 1px);
    background-size: 68px 68px;
    -webkit-mask-image: radial-gradient(75% 70% at 20% 15%, #000 0%, transparent 100%);
  }
  .glow {
    position: absolute; top: -220px; left: -180px; width: 620px; height: 620px;
    border-radius: 999px; background: rgba(210,96,63,.13); filter: blur(130px);
  }
  .inner { position: relative; padding: 68px 76px; height: 100%; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .tile { width: 76px; height: 76px; border-radius: 21px; background: #D2603F; display: flex; align-items: center; justify-content: center; }
  .tile svg { width: 47px; height: 47px; }
  .word { font-size: 44px; font-weight: 500; letter-spacing: -.045em; }
  .body { margin-top: auto; }
  .eyebrow { font-size: 25px; font-weight: 500; color: #A8482B; margin-bottom: 22px; }
  h1 { font-size: 82px; font-weight: 500; letter-spacing: -.04em; line-height: .98; max-width: 17ch; }
  h1 .hl { color: #D2603F; }
  .sub { margin-top: 30px; font-size: 26px; line-height: 1.5; color: rgba(14,16,19,.65); max-width: 44ch; }
  .foot { margin-top: 44px; display: flex; align-items: center; gap: 14px; font-size: 22px; color: rgba(14,16,19,.6); }
  .dot { width: 7px; height: 7px; border-radius: 999px; background: #D2603F; }
</style></head>
<body>
  <div class="grid"></div><div class="glow"></div>
  <div class="inner">
    <div class="brand">
      <span class="tile"><svg viewBox="0 0 100 100"><path d="${ARCH}" fill="#F7F7F4"/></svg></span>
      <span class="word">haazir</span>
    </div>
    <div class="body">
      ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
      <h1>Someone is <span class="hl">always</span> at the window.</h1>
      <div class="sub">WhatsApp agents that answer, book and confirm on their own — in Hindi, English and Hinglish.</div>
      <div class="foot"><span class="dot"></span> Jaipur, Rajasthan &nbsp;·&nbsp; On the official WhatsApp Business Platform</div>
    </div>
  </div>
</body></html>`
}

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

if (!existsSync(executablePath)) {
  console.error(`No Chromium at ${executablePath}. Set PLAYWRIGHT_CHROMIUM to one.`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })

for (const segment of [DEFAULT_SEGMENT, ...SEGMENTS]) {
  const file = segment.slug ? `og-${segment.slug}.png` : 'og.png'
  await page.setContent(card(segment.slug ? `For ${segment.name}` : null), { waitUntil: 'load' })
  await page.screenshot({ path: resolve(OUT, file) })
  console.log('wrote public/' + file)
}

await browser.close()
