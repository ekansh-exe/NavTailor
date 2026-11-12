import BulletsEditor from './BulletsEditor.jsx';
import { EmptyNote } from '../ui/Status.jsx';
import { Button, ItemCard, Section, TagInput, TextField } from './ui.jsx';
import { LIMIT, newProject, newProjectBullet, removeAt, setAt } from './model.js';

export default function ProjectsSection({ items, onChange }) {
  return (
    <Section title="Projects" tag={`${items.length}/${LIMIT.projects}`}>
      {items.length === 0 && <EmptyNote>No projects yet. Side projects count, especially for a first job.</EmptyNote>}
      {items.map((project, i) => (
        <ItemCard
          key={project.id}
          title={project.name || `Project ${i + 1}`}
          onRemove={() => onChange(removeAt(items, i))}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Name"
              value={project.name}
              onChange={(name) => onChange(setAt(items, i, { name }))}
              maxLength={LIMIT.short}
            />
            <TextField
              label="Link"
              type="url"
              placeholder="https://github.com/you/project"
              value={project.link}
              onChange={(link) => onChange(setAt(items, i, { link }))}
              maxLength={LIMIT.url}
            />
          </div>
          <TagInput
            label="Skills"
            value={project.skills}
            onChange={(skills) => onChange(setAt(items, i, { skills }))}
            max={LIMIT.itemSkills}
          />
          <BulletsEditor
            bullets={project.bullets}
            onChange={(bullets) => onChange(setAt(items, i, { bullets }))}
            max={LIMIT.projectBullets}
            makeBullet={newProjectBullet}
          />
        </ItemCard>
      ))}
      <Button
        data-add onClick={() => onChange([...items, newProject()])} softDisabled={items.length >= LIMIT.projects}>
        + Add project
      </Button>
    </Section>
  );
}
