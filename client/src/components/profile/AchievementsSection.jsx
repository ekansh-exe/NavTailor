import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, Section, TextField } from './ui.jsx';
import { LIMIT, newAchievement, removeAt, setAt } from './model.js';

// Optional. One line each; printed as-is on every tailored resume (never rewritten by the LLM).
export default function AchievementsSection({ items, onChange }) {
  return (
    <Section title="Achievements" tag={`${items.length}/${LIMIT.achievements}`}>
      {items.length === 0 && (
        <EmptyNote>Optional. Hackathon wins, ranks, awards. Leave it empty and the section stays off your resume.</EmptyNote>
      )}
      {items.map((item, i) => (
        <ItemCard key={item.id} title={`Achievement ${i + 1}`} onRemove={() => onChange(removeAt(items, i))}>
          <TextField
            label="Achievement"
            placeholder="Winner, Smart India Hackathon 2024, among 500+ teams"
            value={item.text}
            onChange={(text) => onChange(setAt(items, i, { text }))}
            maxLength={LIMIT.achievement}
          />
        </ItemCard>
      ))}
      <Button data-add onClick={() => onChange([...items, newAchievement()])} softDisabled={items.length >= LIMIT.achievements}>
        + Add achievement
      </Button>
    </Section>
  );
}
