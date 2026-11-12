import { Section, TagInput } from './ui.jsx';
import { LIMIT } from './model.js';

// The top-level skills inventory: three tag lists inside one `skills` object.
export default function SkillsSection({ skills, onChange }) {
  const set = (patch) => onChange({ ...skills, ...patch });

  return (
    <Section title="Skills" tag="Inventory">
      <TagInput
        label="Languages"
        value={skills.languages}
        onChange={(languages) => set({ languages })}
        max={LIMIT.skillList}
      />
      <TagInput
        label="Frameworks"
        value={skills.frameworks}
        onChange={(frameworks) => set({ frameworks })}
        max={LIMIT.skillList}
      />
      <TagInput
        label="Tools"
        value={skills.tools}
        onChange={(tools) => set({ tools })}
        max={LIMIT.skillList}
      />
    </Section>
  );
}
