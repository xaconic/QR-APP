import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQRPayload, parseQRPayload } from '../lib/qr.ts';

test('parses an attendance QR payload', () => {
  const raw = buildQRPayload({
    eventId: 'PASKO-IT',
    token: '3f4c69d3-9300-4e4f-8c93-9a97a22e73f1',
  });

  assert.deepEqual(parseQRPayload(raw), {
    ok: true,
    payload: {
      v: 2,
      event: 'PASKO-IT',
      token: '3f4c69d3-9300-4e4f-8c93-9a97a22e73f1',
    },
  });
});

test('rejects malformed, unsupported, and empty-event QR payloads', () => {
  assert.equal(parseQRPayload('{').ok, false);
  assert.equal(parseQRPayload('{"v":1,"event":"PASKO-IT"}').ok, false);
  assert.equal(parseQRPayload('{"v":2,"event":"PASKO-IT"}').ok, false);
  assert.equal(parseQRPayload('{"v":2,"event":"","token":"3f4c69d3-9300-4e4f-8c93-9a97a22e73f1"}').ok, false);
  assert.equal(parseQRPayload('{"v":2,"event":7,"token":"3f4c69d3-9300-4e4f-8c93-9a97a22e73f1"}').ok, false);
  assert.equal(parseQRPayload('{"v":2,"event":"INVALID CODE","token":"3f4c69d3-9300-4e4f-8c93-9a97a22e73f1"}').ok, false);
  assert.equal(parseQRPayload(`{"v":2,"event":"${'A'.repeat(41)}","token":"3f4c69d3-9300-4e4f-8c93-9a97a22e73f1"}`).ok, false);
  assert.equal(parseQRPayload('{"v":2,"event":"PASKO-IT","token":"not-a-uuid"}').ok, false);
});
