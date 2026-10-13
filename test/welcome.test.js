// Unit tests for the welcome of new members: where it goes and what it says. No Discord connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT } from '../src/config.js';
import { WELCOME_CHANNEL, welcomeMessage } from '../src/texts.js';

const specs = LAYOUT.flatMap((g) => g.channels);
const state = { channels: Object.fromEntries(specs.map((c, i) => [c.key, String(100000000000000000n + BigInt(i))])) };

test('the welcome goes to #new-members: a read-only channel in "start here", right after #welcome', () => {
  const start = LAYOUT.find((g) => g.key === 'start');
  const keys = start.channels.map((c) => c.key);
  assert.equal(WELCOME_CHANNEL, 'newmembers');
  assert.equal(keys.indexOf('newmembers'), keys.indexOf('welcome') + 1);
  const spec = start.channels.find((c) => c.key === WELCOME_CHANNEL);
  assert.equal(spec.name, 'new-members');
  assert.equal(spec.type, 'text');
  assert.equal(spec.readonly, true);
  // the target resolves to the new channel's ID, not #general's
  assert.equal(state.channels[WELCOME_CHANNEL], state.channels.newmembers);
  assert.notEqual(state.channels[WELCOME_CHANNEL], state.channels.general);
});

test('welcome: up to 5 people are named, beyond that one "welcome everyone"', () => {
  const few = welcomeMessage(['1', '2'], 42, state);
  assert.equal(few.content, '<@1> <@2>');
  assert.deepEqual(few.allowedMentions, { users: ['1', '2'] });
  assert.match(few.embeds[0].data.description, /all of you.*\*\*42\*\*/s);
  assert.match(few.embeds[0].data.description, new RegExp(`<#${state.channels.welcome}>`));

  const many = welcomeMessage(['1', '2', '3', '4', '5', '6'], undefined, state);
  assert.equal(many.content, undefined);
  assert.deepEqual(many.allowedMentions, { users: [] });
  assert.match(many.embeds[0].data.description, /\*\*6\*\* people who just joined.*\*\*\?\*\*/s);
});
