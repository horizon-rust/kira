// GET /staff.json: the hub's org chart (src/org-chart.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgChart, route, TTL_MS } from '../src/org-chart.js';

const fakeRes = () => ({ status: 0, headers: {}, body: '', writeHead(st, h) { this.status = st; this.headers = h ?? {}; }, end(b) { this.body = b; } });
const member = (id, name, roles, extra = {}) => ({ id, username: name.toLowerCase(), name, avatar: `https://cdn.discordapp.com/avatars/${id}/a.png?size=128`, roles, ...extra });

test('each person shows once, in the highest tier they hold, sorted by name', () => {
  const { tiers } = orgChart({
    members: [
      member('1', 'Ludo', ['owner', 'team']),
      member('2', 'zed', ['team', 'mod']),
      member('3', 'Pressure', ['mod', 'chiefmod']),
      member('4', 'bob', ['mod']),
      member('5', 'Amy', ['mod']),
    ],
  });
  assert.deepEqual(tiers.map((t) => t.key), ['owner', 'team', 'chiefmod', 'mod', 'support']);
  assert.deepEqual(tiers.map((t) => t.people.map((p) => p.name)), [['Ludo'], ['zed'], ['Pressure'], ['Amy', 'bob'], []]);
});

test('only the confirmed GitHub logins, jobs and Discord avatars leave; no ids', () => {
  const { tiers } = orgChart({
    members: [member('10', 'Anthony', ['team']), member('11', 'Marco', ['mod'], { avatar: 'https://evil.example/x.png' }), member('12', 'Odd', ['mod'])],
    github: { 10: 'dezer-x', 12: 'not a login; <script>' },
    jobs: { 10: 'Design' },
  });
  const [anthony] = tiers[1].people;
  assert.deepEqual(anthony, { name: 'Anthony', username: 'anthony', avatar: 'https://cdn.discordapp.com/avatars/10/a.png?size=128', github: 'dezer-x', job: 'Design' });
  const [marco, odd] = tiers[3].people;
  assert.equal(marco.avatar, null);
  assert.equal(marco.github, null);
  assert.equal(odd.github, null);
  assert.ok(!JSON.stringify(tiers).includes('"id"'));
});

test('the route keeps its answer for TTL_MS, and says 503 until Discord is ready', () => {
  let t = 0;
  let members = null;
  let reads = 0;
  const handler = route({ read: () => { reads++; return members; }, now: () => t });
  let res = fakeRes();
  handler({}, res);
  assert.equal(res.status, 503);
  members = [member('1', 'Ludo', ['owner'])];
  res = fakeRes();
  handler({}, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], `public, max-age=${TTL_MS / 1000}`);
  assert.equal(JSON.parse(res.body).tiers[0].people[0].name, 'Ludo');
  members = [member('1', 'Changed', ['owner'])];
  t += TTL_MS - 1;
  res = fakeRes();
  handler({}, res);
  assert.equal(JSON.parse(res.body).tiers[0].people[0].name, 'Ludo');
  t += 1;
  res = fakeRes();
  handler({}, res);
  assert.equal(JSON.parse(res.body).tiers[0].people[0].name, 'Changed');
  assert.equal(reads, 3);
});
