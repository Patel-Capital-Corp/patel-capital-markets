'use strict';

/**
 * GET /api/sitemap
 * Returns an XML sitemap for patelcapital.markets.
 * Also accessible via /sitemap.xml (routed by vercel.json).
 *
 * Cache-Control: public, max-age=86400 (24 h)
 */

const BASE = 'https://patelcapital.markets';

// lastmod is set to the date of the most recent deployment / content update.
// Update this constant whenever significant content changes are published.
const LAST_MOD = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const URLS = [
  { loc: `${BASE}/`,                         changefreq: 'monthly', priority: '1.0' },
  { loc: `${BASE}/#firm-overview`,           changefreq: 'monthly', priority: '0.8' },
  { loc: `${BASE}/#platform-edge`,           changefreq: 'monthly', priority: '0.8' },
  { loc: `${BASE}/#senior-debt`,             changefreq: 'monthly', priority: '0.9' },
  { loc: `${BASE}/#subordinate-capital`,     changefreq: 'monthly', priority: '0.9' },
  { loc: `${BASE}/#equity`,                  changefreq: 'monthly', priority: '0.9' },
  { loc: `${BASE}/#execution`,               changefreq: 'monthly', priority: '0.7' },
  { loc: `${BASE}/#underwriting`,            changefreq: 'monthly', priority: '0.7' },
  { loc: `${BASE}/#compliance`,              changefreq: 'monthly', priority: '0.6' },
  { loc: `${BASE}/#engage`,                  changefreq: 'monthly', priority: '0.8' },
];

function buildSitemap() {
  const urlEntries = URLS.map(({ loc, changefreq, priority }) =>
    [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${LAST_MOD}</lastmod>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n')
  ).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9',
    '          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
    urlEntries,
    '</urlset>',
  ].join('\n');
}

module.exports = function handler(req, res) {
  // CORS (permissive for sitemap — it is a public resource)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Accept-Encoding');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const xml = buildSitemap();

  res.setHeader('Content-Type',  'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
  res.setHeader('Content-Length', Buffer.byteLength(xml, 'utf8').toString());

  return res.status(200).end(xml);
};
