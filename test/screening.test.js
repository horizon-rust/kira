// Unit tests for the rules screening body setup sends (PATCH /guilds/:id/member-verification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screeningBody, screeningUpToDate, firstSentence, ruleLine } from '../src/screening.js';
import { RULES } from '../src/config.js';

test('screening: one TERMS field with every rule as "Title. first sentence", and it is always on', () => {
  const body = screeningBody(RULES);
  assert.equal(body.enabled, true);
  assert.equal(body.form_fields.length, 1);
  const [field] = body.form_fields;
  assert.equal(field.field_type, 'TERMS');
  assert.equal(field.required, true);
  assert.equal(field.values.length, RULES.length);
  assert.equal(field.values.length, 10);
  assert.equal(field.values[0], 'Be respectful. No harassment, hate speech, slurs, threats or personal attacks.');
  assert.equal(field.values[3], 'No scams or malware. No phishing, fake "free Nitro", or executables.');
  assert.equal(field.values[8], 'No drama with the mods in public. Disagree with a decision? DM Kira: it reaches the mods privately.');
  assert.equal(field.values[9], "Discord's rules apply. Follow the Discord Terms of Service and Community Guidelines (13+).");
  for (const v of field.values) assert.ok(v.length <= 300, v); // Discord's limit for one value
});

test('screening: follows the rules (a new or changed rule changes the body)', () => {
  const more = [...RULES, ['Be kind', 'To new people. Always.']];
  assert.equal(screeningBody(more).form_fields[0].values.at(-1), 'Be kind. To new people.');
  assert.equal(screeningBody(more).enabled, true);
  assert.equal(screeningBody([]).enabled, true);
});

test('screening: the first sentence stops at a full stop + space, not at "?" or inside a word', () => {
  assert.equal(firstSentence('One. Two.'), 'One.');
  assert.equal(firstSentence('Question? Answer here.'), 'Question? Answer here.');
  assert.equal(firstSentence('No full stop'), 'No full stop');
  assert.equal(firstSentence('v1.2 is out. Then more.'), 'v1.2 is out.');
  assert.equal(ruleLine(['A', 'b. c.']), 'A. b.');
});

test('screening: idempotent — nothing to send when Discord already has it, and when the feature is off', () => {
  const body = screeningBody(RULES);
  const current = { description: body.description, form_fields: [{ ...body.form_fields[0], description: null, automations: null }] };
  assert.equal(screeningUpToDate(current, body, true), true);
  assert.equal(screeningUpToDate(current, body, false), false); // feature off: send it to turn it on
  assert.equal(screeningUpToDate({ ...current, description: 'other' }, body, true), false);
  const edited = { ...current, form_fields: [{ ...current.form_fields[0], values: current.form_fields[0].values.slice(1) }] };
  assert.equal(screeningUpToDate(edited, body, true), false);
  assert.equal(screeningUpToDate(null, body, true), false);
});
