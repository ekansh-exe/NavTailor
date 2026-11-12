import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, Section, TextField } from './ui.jsx';
import { LIMIT, newActivity, removeAt, setAt } from './model.js';

// Optional. Positions of responsibility, clubs, volunteering or publications. The user picks the
// section's heading; an empty heading prints as "Activities".
export default function ActivitiesSection({ heading, items, onHeadingChange, onChange }) {
  return (
    <Section title="Activities" tag={`${items.length}/${LIMIT.activities}`}>
      <TextField
        label="Section heading on the resume (optional)"
        placeholder="Activities"
        value={heading ?? ''}
        onChange={onHeadingChange}
        maxLength={LIMIT.heading}
      />
      {items.length === 0 && (
        <EmptyNote>Optional. Clubs, positions you held, volunteering or papers. Leave it empty and the section stays off your resume.</EmptyNote>
      )}
      {items.map((item, i) => (
        <ItemCard key={item.id} title={item.title || `Activity ${i + 1}`} onRemove={() => onChange(removeAt(items, i))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Title"
              placeholder="Technical Lead, Coding Club"
              value={item.title}
              onChange={(title) => onChange(setAt(items, i, { title }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Date or venue"
              placeholder="Aug 2023 – May 2024"
              value={item.detail}
              onChange={(detail) => onChange(setAt(items, i, { detail }))}
              maxLength={LIMIT.short}
            />
          </div>
        </ItemCard>
      ))}
      <Button data-add onClick={() => onChange([...items, newActivity()])} softDisabled={items.length >= LIMIT.activities}>
        + Add activity
      </Button>
    </Section>
  );
}
