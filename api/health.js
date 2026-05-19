'use strict';

/**
 * GET /api/health
 * Lightweight liveness probe for Patel Capital Markets.
 */

const ALLOWED_ORIGIN = 'https://patelcapital.markets';

module.exports = function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', error: 'Method not allowed' });
  }

  // No caching — always fresh
  res.setHeader('Cache-Control', 'no-store');

  return res.status(200).json({
    status:  'ok',
    service: 'patel-capital-markets',
    version: '1.0.0',
    ts:      new Date().toISOString(),
  });
};
