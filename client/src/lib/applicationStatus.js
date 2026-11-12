// The hiring stages an application can be in. Same list and order as the server
// (server/src/models/Application.js APPLICATION_STATUSES); the server rejects anything else.
export const STATUSES = [
  { value: 'saved', label: 'Saved', cls: 'bg-cream' },
  { value: 'applied', label: 'Applied', cls: 'bg-pending' },
  { value: 'interview', label: 'Interview', cls: 'bg-ink text-cream' },
  { value: 'offer', label: 'Offer', cls: 'bg-ok' },
  { value: 'rejected', label: 'Rejected', cls: 'bg-alert' },
];

const BY_VALUE = new Map(STATUSES.map((s) => [s.value, s]));
export const statusInfo = (value) => BY_VALUE.get(value) ?? { value, label: value, cls: 'bg-cream' };
