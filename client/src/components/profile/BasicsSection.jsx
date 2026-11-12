import { Button, Section, TextArea, TextField } from './ui.jsx';
import { LIMIT, removeAt } from './model.js';

// Contact details, links and the summary. `basics` is one object (not a list), and
// `summary` sits beside it at the top level of the profile.
export default function BasicsSection({ basics, summary, onBasicsChange, onSummaryChange }) {
  const set = (patch) => onBasicsChange({ ...basics, ...patch });
  const setLink = (i, url) => set({ links: basics.links.map((l, j) => (j === i ? url : l)) });

  return (
    <Section title="Basics" tag="Contact">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={basics.name}
          onChange={(name) => set({ name })}
          maxLength={LIMIT.short}
        />
        <TextField
          label="Email"
          type="email"
          value={basics.email}
          onChange={(email) => set({ email })}
          maxLength={LIMIT.email}
        />
        <TextField
          label="Phone"
          value={basics.phone}
          onChange={(phone) => set({ phone })}
          maxLength={LIMIT.phone}
        />
        <TextField
          label="Location"
          value={basics.location}
          onChange={(location) => set({ location })}
          maxLength={LIMIT.short}
        />
      </div>

      <div className="space-y-2">
        <span className="block font-mono text-xs uppercase">
          Links ({basics.links.length}/{LIMIT.links})
        </span>
        {basics.links.map((url, i) => (
          // Index keys are fine here: rows are plain strings with no identity of their own.
          <div key={i} className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label={`Link ${i + 1}`}
              type="url"
              placeholder="https://github.com/you"
              value={url}
              onChange={(value) => setLink(i, value)}
              maxLength={LIMIT.url}
            />
            <Button
              variant="danger"
              onClick={() => set({ links: removeAt(basics.links, i) })}
              aria-label={`Remove link ${i + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          onClick={() => set({ links: [...basics.links, ''] })}
          disabled={basics.links.length >= LIMIT.links}
        >
          + Add link
        </Button>
      </div>

      <TextArea
        label="Summary"
        rows={4}
        value={summary}
        onChange={onSummaryChange}
        maxLength={LIMIT.summary}
      />
    </Section>
  );
}
