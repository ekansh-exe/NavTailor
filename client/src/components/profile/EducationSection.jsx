import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, Section, TextField } from './ui.jsx';
import { LIMIT, newEducation, removeAt, setAt } from './model.js';

export default function EducationSection({ items, onChange }) {
  return (
    <Section title="Education" tag={`${items.length}/${LIMIT.education}`}>
      {items.length === 0 && <EmptyNote>No education added yet.</EmptyNote>}
      {items.map((edu, i) => (
        <ItemCard
          key={edu.id}
          title={edu.school || `School ${i + 1}`}
          onRemove={() => onChange(removeAt(items, i))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="School"
              value={edu.school}
              onChange={(school) => onChange(setAt(items, i, { school }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Degree"
              value={edu.degree}
              onChange={(degree) => onChange(setAt(items, i, { degree }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Dates"
              placeholder="2021 – 2025"
              value={edu.dates}
              onChange={(dates) => onChange(setAt(items, i, { dates }))}
              maxLength={LIMIT.dates}
            />
            <TextField
              label="Grade"
              placeholder="8.7 / 10 CGPA"
              // ?? '' because profiles saved before this field existed may not carry it yet.
              value={edu.grade ?? ''}
              onChange={(grade) => onChange(setAt(items, i, { grade }))}
              maxLength={LIMIT.grade}
            />
          </div>
        </ItemCard>
      ))}
      <Button
        data-add onClick={() => onChange([...items, newEducation()])} softDisabled={items.length >= LIMIT.education}>
        + Add education
      </Button>
    </Section>
  );
}
