// The 18+ declaration with no Discord (GOVERNANCE.md section 9; src/features/age.js does the talking). Every role of
// trust is 18+. A member declares it once with a button; Kira keeps only { yes: true, at } under their Discord id:
// never an age, a birth date, an ID or anything else. Current holders are asked once by DM; those who haven't declared
// after AGE.days are listed for the council in #council.

export const DAY = 86_400_000;
export const WORDING = 'I confirm that I am 18 or older. I understand that a false declaration removes all my roles of trust.';

export const isDeclared = (declared, id) => declared?.[String(id)]?.yes === true;

// A new declarations map with `id` declared now. Only the id, yes and the time.
export const record = (declared, id, now) => ({ ...(declared ?? {}), [String(id)]: { yes: true, at: new Date(now).toISOString() } });

// The member ids holding any of `roleIds` (members: [{ id, bot, roles: [role ids] }]), bots left out, sorted.
export const holders = (members, roleIds) => {
  const set = new Set(roleIds.filter(Boolean));
  return [...new Set(members.filter((m) => !m.bot && m.roles.some((r) => set.has(r))).map((m) => String(m.id)))].sort();
};

// Who the sweep still has to DM: holders who neither declared nor were asked already.
export const toAsk = (ids, declared, asked = {}) => ids.filter((id) => !isDeclared(declared, id) && !asked[id]);

// The holders listed for the council once the time is up: asked at least `days` ago and still not declared. → ids.
export const overdue = (ids, declared, asked = {}, now, days) => ids.filter((id) => asked[id] && now - asked[id] >= days * DAY && !isDeclared(declared, id));

// ── Texts ────────────────────────────────────────────────────────────────────
// Never a reason beyond "every important role is 18+", never a word about anyone's age.

export const dmText = (deadline) => [
  '**Horizon: the 18+ declaration**',
  'Every important role on Horizon is 18+ (GOVERNANCE.md, section 9). You hold one, so please confirm with the button below '
    + `by <t:${Math.floor(deadline / 1000)}:F>. Until then, nothing changes; after that date a role with no declaration is paused, and it comes back as soon as you confirm.`,
  `> ${WORDING}`,
  'Kira keeps only your Discord account, "yes" and the date: no age, no birth date, no ID.',
].join('\n');

export const button = { type: 1, components: [{ type: 2, style: 3, label: 'I confirm: I am 18 or older', custom_id: 'age:yes' }] };
export const thanks = 'Thank you: recorded (your Discord account, "yes" and the date, nothing else).';
export const already = 'You have already confirmed. Nothing else to do.';
export const promptText = ['**The 18+ declaration**', 'Every important role on Horizon is 18+ (GOVERNANCE.md, section 9).', `> ${WORDING}`, 'Kira keeps only your Discord account, "yes" and the date.'].join('\n');
export const overdueText = (ids, days) => `The 18+ declaration: ${ids.length} role holder${ids.length === 1 ? '' : 's'} asked ${days} days ago ${ids.length === 1 ? 'has' : 'have'} not confirmed yet: ${ids.map((id) => `<@${id}>`).join(', ')}. Under GOVERNANCE.md 9 their roles of trust are paused until they confirm: a council member pauses them, or asks them privately first.`;
