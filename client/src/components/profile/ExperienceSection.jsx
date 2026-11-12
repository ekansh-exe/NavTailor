import BulletsEditor from './BulletsEditor.jsx';
import { Button, ItemCard, Section, TextField } from './ui.jsx';
import { LIMIT, newExperience, newExperienceBullet, removeAt, setAt } from './model.js';

export default function ExperienceSection({ items, onChange }) {
  return (
    <Section title="Experience" tag={`${items.length}/${LIMIT.experience}`}>
      {items.map((job, i) => (
        <ItemCard
          key={job.id}
          title={job.company || `Job ${i + 1}`}
          onRemove={() => onChange(removeAt(items, i))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Company"
              value={job.company}
              onChange={(company) => onChange(setAt(items, i, { company }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Role"
              value={job.role}
              onChange={(role) => onChange(setAt(items, i, { role }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Dates"
              placeholder="Jan 2023 – Present"
              value={job.dates}
              onChange={(dates) => onChange(setAt(items, i, { dates }))}
              maxLength={LIMIT.dates}
            />
          </div>
          <BulletsEditor
            bullets={job.bullets}
            onChange={(bullets) => onChange(setAt(items, i, { bullets }))}
            max={LIMIT.experienceBullets}
            makeBullet={newExperienceBullet}
            showAlwaysInclude
          />
        </ItemCard>
      ))}
      <Button onClick={() => onChange([...items, newExperience()])} disabled={items.length >= LIMIT.experience}>
        + Add job
      </Button>
    </Section>
  );
}
