import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates API key from Authorization header.
 * If API_KEY env var is not set, allows all requests (development mode).
 */
export function validateApiKey(request: NextRequest): NextResponse | null {
  const apiKey = process.env.API_KEY;

  // If no API key configured, allow all requests (dev mode)
  if (!apiKey) return null;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7);
  if (token !== apiKey) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 403 }
    );
  }

  return null; // Valid — continue
}
