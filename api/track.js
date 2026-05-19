'use strict';

/**
 * POST /api/track
 * Analytics ingestion endpoint (Plausible-compatible) for Patel Capital Markets.
 *
 * Environment variables (optional):
 *   PLAUSIBLE_API_KEY  — Plausible API key
 *   PLAUSIBLE_DOMAIN   — Plausible site domain (default: patelcapital.markets)
 *
 * If the env vars are absent the event is accepted but not forwarded.
 */

const ALLOWED_ORIGIN    = 'https://patelcapital.markets';
const DEFAULT_URL       = 'https://patelcapital.markets/';
const DEFAULT_DOMAIN    = 'patelcapital.markets';
const MAX_EVENT_LENGTH  = 64;

// Fields that might contain PII — stripped before forwarding
const PII_FIELD_PATTERN = /^(email|phone|mobile|tel|ssn|dob|birth|credit|card|password|passwd|secret|token)/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

/**
 * Remove keys that look like PII from a props object.
 * Returns a new plain object with string values only (non-strings are dropped).
 */
function sanitizeProps(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const clean = {};

  for (const [key, value] of Object.entries(raw)) {
    // Skip PII-looking keys
    if (PII_FIELD_PATTERN.test(key)) continue;

    // Only keep scalar string/number/boolean values; objects/arrays are dropped
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      // Truncate strings to avoid outsized payloads
      clean[key] = typeof value === 'string' ? value.slice(0, 500) : value;
    }
  }

  return clean;
}

// ---------------------------------------------------------------------------
// Plausible forwarding
// ---------------------------------------------------------------------------

async function forwardToPlausible(body, req, sanitizedProps) {
  const apiKey = process.env.PLAUSIBLE_API_KEY;
  const domain = process.env.PLAUSIBLE_DOMAIN || DEFAULT_DOMAIN;

  if (!apiKey) return; // nothing to do

  const payload = {
    name:   body.event,
    url:    body.url || DEFAULT_URL,
    domain: domain,
    props:  sanitizedProps,
  };

  // Optionally attach referrer if present
  if (body.referrer && typeof body.referrer === 'string') {
    payload.referrer = body.referrer.slice(0, 2048);
  }

  try {
    const fwdRes = await fetch('https://plausible.io/api/event', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'User-Agent':      req.headers['user-agent'] || 'PCM/1.0',
        'X-Forwarded-For': (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
        'Authorization':   'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!fwdRes.ok) {
      const text = await fwdRes.text().catch(() => '(no body)');
      console.warn(`[PCM track] Plausible returned ${fwdRes.status}: ${text}`);
    }
  } catch (err) {
    // Never surface Plausible errors to the client
    console.error('[PCM track] Plausible forward error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  setCors(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ---- Parse body ----------------------------------------------------------
  let body;
  try {
    body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request body' });
  }

  // ---- Validate event name -------------------------------------------------
  if (!body.event || typeof body.event !== 'string' || !body.event.trim()) {
    return res.status(422).json({ ok: false, error: 'event is required and must be a non-empty string' });
  }

  if (body.event.length > MAX_EVENT_LENGTH) {
    return res.status(422).json({ ok: false, error: `event must be ${MAX_EVENT_LENGTH} characters or fewer` });
  }

  // ---- Sanitize props ------------------------------------------------------
  const sanitizedProps = sanitizeProps(body.props);

  // ---- Forward (non-blocking from client perspective) ---------------------
  // We await here so errors are caught, but the client always gets 200
  await forwardToPlausible(body, req, sanitizedProps);

  // Always return success — analytics must never break the calling page
  return res.status(200).json({ ok: true });
};
