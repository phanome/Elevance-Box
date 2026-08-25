const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveLeadSignal, normalizeClassification } = require('../lead');

test('detects direct and Telugu buying intent as hot', () => {
  assert.equal(deriveLeadSignal('How much will the store cost and when can you start?'), 'HOT');
  assert.equal(deriveLeadSignal('మీరు ఎప్పుడు ప్రారంభించగలరు?'), 'HOT');
  assert.equal(deriveLeadSignal('send me the details on whatsapp'), 'HOT');
  assert.equal(deriveLeadSignal('how soon can you start?'), 'HOT');
});

test('detects a decision barrier as warm and disinterest as cold', () => {
  assert.equal(deriveLeadSignal('My budget is tight; call me back tomorrow.'), 'WARM');
  assert.equal(deriveLeadSignal('my budget is not much right now'), 'WARM');
  assert.equal(deriveLeadSignal('my brother handles this, ask him later'), 'WARM');
  assert.equal(deriveLeadSignal('I am not interested, please do not call.'), 'COLD');
  assert.equal(deriveLeadSignal('just browsing, don’t need anything'), 'COLD');
});

test('normalizes model classifications safely', () => {
  assert.equal(normalizeClassification('hot'), 'HOT');
  assert.equal(normalizeClassification('unexpected'), 'WARM');
});
