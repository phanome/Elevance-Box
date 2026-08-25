const test = require('node:test');
const assert = require('node:assert/strict');
const { hasCallbackRequest, parseCallbackTime } = require('../scheduler');

test('recognizes English, Hindi and Telugu callback requests', () => {
  assert.equal(hasCallbackRequest('Please call me tomorrow morning'), true);
  assert.equal(hasCallbackRequest('कल मुझे कॉल करना'), true);
  assert.equal(hasCallbackRequest('రేపు నాకు కాల్ చేయండి'), true);
});

test('uses a reliable 10 AM default for a date-only callback', () => {
  const now = new Date('2026-08-23T03:00:00.000Z');
  const parsed = parseCallbackTime('call me tomorrow', now);
  assert.equal(parsed.date.getHours(), 10);
  assert.ok(parsed.date > now);
});
