import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, Section, TagInput, TextField } from './ui.jsx';
import { LIMIT, newCertification, removeAt, setAt } from './model.js';

export default function CertificationsSection({ items, onChange }) {
  return (
    <Section title="Certifications" tag={`${items.length}/${LIMIT.certifications}`}>
      {items.length === 0 && <EmptyNote>No certifications yet. Optional: add one only if it matters for the jobs you want.</EmptyNote>}
      {items.map((cert, i) => (
        <ItemCard
          key={cert.id}
          title={cert.name || `Certification ${i + 1}`}
          onRemove={() => onChange(removeAt(items, i))}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="Name"
              value={cert.name}
              onChange={(name) => onChange(setAt(items, i, { name }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Issuer"
              value={cert.issuer}
              onChange={(issuer) => onChange(setAt(items, i, { issuer }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Year"
              value={cert.year}
              onChange={(year) => onChange(setAt(items, i, { year }))}
              maxLength={LIMIT.year}
            />
          </div>
          <TagInput
            label="Skills"
            value={cert.skills}
            onChange={(skills) => onChange(setAt(items, i, { skills }))}
            max={LIMIT.itemSkills}
          />
        </ItemCard>
      ))}
      <Button
        data-add
        onClick={() => onChange([...items, newCertification()])}
        softDisabled={items.length >= LIMIT.certifications}
      >
        + Add certification
      </Button>
    </Section>
  );
}
