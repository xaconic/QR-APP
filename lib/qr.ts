export type QRPayload = {
  v: 2;
  event: string;
  token: string;
};

export type ParseQRResult =
  | { ok: true; payload: QRPayload }
  | { ok: false; message: string };

export function buildQRPayload(event: { eventId: string; token: string }): string {
  return JSON.stringify({ v: 2, event: event.eventId, token: event.token } satisfies QRPayload);
}

export function parseQRPayload(raw: string): ParseQRResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'Invalid QR code.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  const payload = parsed as Record<string, unknown>;
  if (payload.v !== 2
    || typeof payload.event !== 'string'
    || payload.event.length > 40
    || !/^[A-Za-z0-9_-]+$/.test(payload.event)
    || typeof payload.token !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.token)) {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  return {
    ok: true,
    payload: {
      v: 2,
      event: payload.event,
      token: payload.token,
    },
  };
}