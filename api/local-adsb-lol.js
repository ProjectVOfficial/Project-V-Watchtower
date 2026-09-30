import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

const ADSB_LOL_ORIGIN = 'https://api.adsb.lol';
const TIMEOUT_MS = 15000;

function jsonError(message, status, corsHeaders) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

function normalizeAllowedPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 180) return null;

  if (value === '/v2/mil' || value === '/v2/pia' || value === '/v2/ladd') {
    return value;
  }

  const match = value.match(/^\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d{1,3})$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  const radius = Number(match[3]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  if (!Number.isInteger(radius) || radius < 1 || radius > 250) return null;

  return `/v2/point/${lat}/${lon}/${radius}`;
}

export default async function handler(req) {
  const corsHeaders = getCorsHeaders(req, 'GET, OPTIONS');

  if (isDisallowedOrigin(req)) {
    return jsonError('Origin not allowed', 403, corsHeaders);
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return jsonError('Method not allowed', 405, corsHeaders);
  }

  const requestUrl = new URL(req.url);
  const path = normalizeAllowedPath(requestUrl.searchParams.get('path'));
  if (!path) {
    return jsonError('Unsupported ADSB.lol path', 400, corsHeaders);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ADSB_LOL_ORIGIN}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Project-V-Watchtower/1.1',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const body = await response.text();
    const headers = {
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    };
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) headers['Retry-After'] = retryAfter;

    return new Response(body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    const timeoutError = error?.name === 'AbortError';
    return jsonError(
      timeoutError ? 'ADSB.lol request timed out' : 'ADSB.lol request failed',
      timeoutError ? 504 : 502,
      corsHeaders,
    );
  } finally {
    clearTimeout(timeout);
  }
}
