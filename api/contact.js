'use strict';

/**
 * POST /api/contact
 * Deal intake form handler for Patel Capital Markets.
 *
 * Environment variables (optional):
 *   RESEND_API_KEY     — preferred email provider
 *   SENDGRID_API_KEY   — fallback email provider
 *
 * If neither key is set the submission is logged to stdout (dev mode).
 */

const ALLOWED_ORIGIN = 'https://patelcapital.markets';
const TO_EMAIL       = 'deals@patelcapital.markets';
const FROM_EMAIL     = 'noreply@patelcapital.markets';
const FROM_NAME      = 'PCM Deal Intake';

// ---------------------------------------------------------------------------
// In-memory rate-limit store.
// Serverless functions may spin up multiple instances, so this is a
// best-effort guard against casual abuse.  For strict rate-limiting use
// an external KV store (e.g. Vercel KV / Upstash Redis).
// ---------------------------------------------------------------------------
const rateLimitMap = new Map(); // key: IP string  →  { count, resetAt }

const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function isRateLimited(ip) {
  const now    = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return true;
  }

  record.count += 1;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setCors(res, method) {
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function isValidEmail(str) {
  // RFC-5321-ish sanity check — not exhaustive but catches obvious typos
  return typeof str === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim());
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(body) {
  return [
    '<h2>New Deal Inquiry</h2>',
    `<p><b>Name:</b> ${escapeHtml(body.name)}</p>`,
    `<p><b>Email:</b> ${escapeHtml(body.email)}</p>`,
    `<p><b>Deal Type:</b> ${escapeHtml(body.dealType || '—')}</p>`,
    `<p><b>Size:</b> ${escapeHtml(body.size || '—')}</p>`,
    '<p><b>Message:</b></p>',
    `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(body.message)}</pre>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Email dispatch
// ---------------------------------------------------------------------------

async function sendViaResend(body) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:     `${FROM_NAME} <${FROM_EMAIL}>`,
      to:       [TO_EMAIL],
      reply_to: body.email,
      subject:  `[PCM Deal] ${body.dealType || 'New Inquiry'} — ${body.name}`,
      html:     buildHtml(body),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`Resend ${res.status}: ${text}`);
  }

  return await res.json();
}

async function sendViaSendGrid(body) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: TO_EMAIL }] }],
      from:     { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email: body.email, name: body.name },
      subject:  `[PCM Deal] ${body.dealType || 'New Inquiry'} — ${body.name}`,
      content:  [{ type: 'text/html', value: buildHtml(body) }],
    }),
  });

  // SendGrid 202 = accepted (no JSON body)
  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`SendGrid ${res.status}: ${text}`);
  }
}

async function dispatchEmail(body) {
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(body);
  }

  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid(body);
  }

  // Dev mode — no keys configured
  console.log('[PCM contact] dev mode — email not sent:', {
    name:     body.name,
    email:    body.email,
    dealType: body.dealType,
    size:     body.size,
    // omit message body from logs
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  setCors(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // ---- Rate limiting --------------------------------------------------------
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again later.' });
  }

  // ---- Parse body ----------------------------------------------------------
  let body;
  try {
    // Vercel automatically parses JSON bodies, but guard against edge cases
    body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid request body' });
  }

  // ---- Honeypot ------------------------------------------------------------
  if (body.honeypot) {
    // Silent success — do not reveal the trap to bots
    return res.status(200).json({ ok: true, id: 'pcm-' + Date.now() });
  }

  // ---- Validation ----------------------------------------------------------
  const errors = [];

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    errors.push('Name is required.');
  }

  if (!body.email || !isValidEmail(body.email)) {
    errors.push('A valid email address is required.');
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    errors.push('Message is required.');
  } else if (body.message.length > 2000) {
    errors.push('Message must be 2 000 characters or fewer.');
  }

  if (errors.length) {
    return res.status(422).json({ ok: false, error: errors.join(' ') });
  }

  // ---- Sanitize ------------------------------------------------------------
  const sanitized = {
    name:     body.name.trim().slice(0, 200),
    email:    body.email.trim().toLowerCase(),
    dealType: typeof body.dealType === 'string' ? body.dealType.trim().slice(0, 100) : '',
    size:     typeof body.size     === 'string' ? body.size.trim().slice(0, 100)     : '',
    message:  body.message.trim(),
  };

  // ---- Send / log ----------------------------------------------------------
  try {
    await dispatchEmail(sanitized);
  } catch (err) {
    console.error('[PCM contact] email dispatch failed:', err.message);
    // Return a 500 so the client knows the submission did not succeed
    return res.status(500).json({ ok: false, error: 'Failed to send message. Please try again or email us directly.' });
  }

  return res.status(200).json({ ok: true, id: 'pcm-' + Date.now() });
};
