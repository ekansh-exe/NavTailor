import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, TagInput, TextArea, Toggle } from './ui.jsx';
import { LIMIT, removeAt, setAt } from './model.js';

// Bullet list used inside a job or a project. Add/remove bullets, edit the text, tag the
// skills each bullet shows off, and (jobs only) flag a bullet as "always include".
export default function BulletsEditor({ bullets, onChange, max, makeBullet, showAlwaysInclude }) {
  return (
    <div className="space-y-3" data-list>
      {bullets.length === 0 && (
        <EmptyNote>No bullets yet. Each bullet is one thing you did; the tailoring picks the best ones per job.</EmptyNote>
      )}
      {bullets.map((bullet, i) => (
        <ItemCard
          key={bullet.id}
          title={`Bullet ${i + 1}`}
          onRemove={() => onChange(removeAt(bullets, i))}
        >
          <TextArea
            label="Text"
            value={bullet.text}
            onChange={(text) => onChange(setAt(bullets, i, { text }))}
            maxLength={LIMIT.bullet}
          />
          <TagInput
            label="Skills"
            value={bullet.skills}
            onChange={(skills) => onChange(setAt(bullets, i, { skills }))}
            max={LIMIT.itemSkills}
          />
          {showAlwaysInclude && (
            <Toggle
              label="Always include"
              checked={bullet.alwaysInclude}
              onChange={(alwaysInclude) => onChange(setAt(bullets, i, { alwaysInclude }))}
            />
          )}
        </ItemCard>
      ))}
      <Button data-add onClick={() => onChange([...bullets, makeBullet()])} softDisabled={bullets.length >= max}>
        + Add bullet
      </Button>
    </div>
  );
}
