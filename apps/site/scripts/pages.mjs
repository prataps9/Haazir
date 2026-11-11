/**
 * Post-build: turns the single-page bundle into one real static page per
 * outreach variant — dist/jewellers/index.html, dist/clinics/index.html, and
 * so on.
 *
 * Why not client-side routing: a link pasted into WhatsApp is read by a crawler
 * that never runs JavaScript. It sees only the HTML it was served. So each
 * variant needs its own file carrying its own <title>, description and og:image,
 * or every link previews identically and the personalisation is invisible in the
 * one place it matters most.
 *
 * The JS bundle is shared and unchanged — it reads the path at runtime
 * (src/lib/campaign.js) and renders the matching copy.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEGMENTS } from '../src/lib/segments.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'dist')

const SITE = process.env.SITE_URL ?? 'https://haazir-pink.vercel.app'

const source = readFileSync(resolve(DIST, 'index.html'), 'utf8')

/**
 * Structured data for search engines: what haazir is and where it works from.
 * No price, rating or review is claimed here; the page itself carries the prices.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'ProfessionalService',
      '@id': `${SITE}/#studio`,
      name: 'haazir',
      url: `${SITE}/`,
      image: `${SITE}/og.png`,
      description:
        'A Jaipur studio that builds WhatsApp AI agents for Indian businesses: replies to enquiries, bookings, reminders, follow-ups and campaigns on one number.',
      address: { '@type': 'PostalAddress', addressLocality: 'Jaipur', addressRegion: 'Rajasthan', addressCountry: 'IN' },
      areaServed: 'IN',
      knowsLanguage: ['hi', 'en'],
    },
    {
      '@type': 'SoftwareApplication',
      name: 'haazir',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, WhatsApp',
      provider: { '@id': `${SITE}/#studio` },
    },
  ],
}
// "<" escaped so nothing inside the JSON can close the script tag.
const html = source.replace(
  '</head>',
  `  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n  </head>`,
)
if (html === source) throw new Error('pages.mjs: no </head> in dist/index.html')
writeFileSync(resolve(DIST, 'index.html'), html)


/** Replaces the content of a single meta/link tag, matched on its identifying attribute. */
function setTag(source, attr, name, content) {
  const re = new RegExp(`(<(?:meta|link)\\s+[^>]*${attr}="${name}"[^>]*?(?:content|href)=")[^"]*(")`)
  if (!re.test(source)) {
    throw new Error(`pages.mjs: no tag with ${attr}="${name}" in dist/index.html`)
  }
  return source.replace(re, `$1${content}$2`)
}

for (const segment of SEGMENTS) {
  const url = `${SITE}/${segment.slug}`
  const title = `haazir — WhatsApp agents for ${segment.name}`
  const description = segment.subhead

  let page = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"[\s\S]*?content=")[\s\S]*?(")/, `$1${description}$2`)

  page = setTag(page, 'rel', 'canonical', url)
  page = setTag(page, 'property', 'og:url', url)
  page = setTag(page, 'property', 'og:title', title)
  page = setTag(page, 'property', 'og:description', description)
  page = setTag(page, 'property', 'og:image', `${SITE}/og-${segment.slug}.png`)
  page = setTag(page, 'name', 'twitter:title', title)
  page = setTag(page, 'name', 'twitter:description', description)
  page = setTag(page, 'name', 'twitter:image', `${SITE}/og-${segment.slug}.png`)

  // Flat files, not slug/index.html: paired with "cleanUrls" in vercel.json this
  // serves /jewellers directly. A directory index only answered on /jewellers/
  // — and nobody pastes a trailing slash into a WhatsApp message.
  writeFileSync(resolve(DIST, `${segment.slug}.html`), page)
  console.log(`wrote dist/${segment.slug}.html`)
}

// robots.txt and the sitemap carry the same domain as the pages, so one
// SITE_URL change moves all of them.
const urls = [`${SITE}/`, ...SEGMENTS.map((s) => `${SITE}/${s.slug}`)]
writeFileSync(
  resolve(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
)
writeFileSync(resolve(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)
console.log('wrote dist/sitemap.xml and dist/robots.txt')
