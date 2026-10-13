// Rules screening (Discord's "Membership Screening"): new members read the rules and agree before they can talk.
// The body is built from RULES, so setup keeps it right when the rules change. It only ever turns screening on.

export const SCREENING = {
  description: 'Read and agree to the rules to start chatting.',
  label: 'Read and agree to the server rules',
};

// "Title. first sentence": the first sentence ends at the first full stop followed by a space (a "?" does not end it).
export const firstSentence = (text) => text.match(/^.*?\.(?=\s|$)/s)?.[0] ?? text;
export const ruleLine = ([title, description]) => `${title}. ${firstSentence(description)}`;

export function screeningBody(rules) {
  return {
    enabled: true, // never false: turning screening off is not setup's job
    description: SCREENING.description,
    form_fields: [{ field_type: 'TERMS', label: SCREENING.label, values: rules.map(ruleLine), required: true }],
  };
}

// Whether what Discord has (the GET answer, and whether the guild feature is on) already is `body`.
export function screeningUpToDate(current, body, featureOn) {
  const field = current?.form_fields?.[0];
  const want = body.form_fields[0];
  return featureOn
    && current?.form_fields?.length === 1
    && current.description === body.description
    && field?.field_type === want.field_type
    && field.label === want.label
    && !!field.required === want.required
    && JSON.stringify(field.values) === JSON.stringify(want.values);
}
