import { useState } from 'react';
import { LIMIT } from './model.js';

// Neo-brutalist building blocks: 2px black borders, hard offset shadow, no rounding, no blur.

const INPUT =
  'w-full border-2 border-ink bg-cream px-3 py-2 font-mono text-sm placeholder:text-ink/50 focus:shadow-hard focus:outline-none disabled:opacity-50';

const BUTTON_BASE =
  'cursor-pointer border-2 border-ink px-3 py-2 font-mono text-xs font-bold uppercase disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANT = {
  // Main action: filled.
  primary:
    'bg-ink text-cream shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none disabled:shadow-none',
  // "Add ..." actions.
  secondary:
    'bg-cream text-ink shadow-hard active:translate-x-1 active:translate-y-1 active:shadow-none disabled:shadow-none',
  // "Remove": flat, turns red on hover so it reads as destructive.
  danger: 'bg-cream text-ink hover:bg-alert disabled:hover:bg-cream',
};

// type="button" by default so a button can never accidentally submit a form.
export function Button({ variant = 'secondary', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}

// A big card for one profile section (Basics, Experience, ...).
export function Section({ title, tag, children }) {
  return (
    <section className="border-2 border-ink bg-cream p-6 shadow-hard">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-xl">{title}</h2>
        {tag && (
          <span className="border-2 border-ink px-2 py-1 font-mono text-xs uppercase">{tag}</span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// A card for one item inside a section (one job, one project, one bullet...).
export function ItemCard({ title, onRemove, removeLabel = 'Remove', children }) {
  return (
    <div className="border-2 border-ink bg-cream p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm">{title}</h3>
        <Button variant="danger" onClick={onRemove} aria-label={`${removeLabel} ${title}`}>
          {removeLabel}
        </Button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  type = 'text',
  placeholder,
  className = '',
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block font-mono text-xs uppercase">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        className={INPUT}
      />
    </label>
  );
}

export function TextArea({ label, value, onChange, maxLength, rows = 3, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between font-mono text-xs uppercase">
        <span>{label}</span>
        {maxLength && (
          // aria-hidden keeps "12/500" out of the field's accessible name (just "Text").
          <span aria-hidden="true">
            {value.length}/{maxLength}
          </span>
        )}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className={`${INPUT} resize-y`}
      />
    </label>
  );
}

// A checkbox that looks like a hard-edged square. role="switch" + aria-checked makes it
// readable by screen readers as an on/off toggle.
export function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex cursor-pointer items-center gap-2 font-mono text-xs font-bold uppercase"
    >
      <span
        className={`flex h-6 w-6 items-center justify-center border-2 border-ink ${
          checked ? 'bg-ink text-cream' : 'bg-cream'
        }`}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

// Type a skill, press Enter (or type a comma) to turn it into a tag. Backspace on an empty
// box removes the last tag. Duplicates (ignoring case), empty tags and tags past `max` are
// skipped. Whatever is still typed when the box loses focus is added too, so clicking
// Save straight after typing never loses the last tag.
export function TagInput({ label, value, onChange, max, maxLength = LIMIT.tag }) {
  const [draft, setDraft] = useState('');
  const full = value.length >= max;

  function addTags(candidates) {
    const next = [...value];
    for (const raw of candidates) {
      const tag = raw.trim().slice(0, maxLength);
      if (!tag || next.length >= max) continue;
      if (next.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
      next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
  }

  function handleChange(text) {
    if (!text.includes(',')) return setDraft(text);
    // "React, Vue, Sv" -> add React and Vue, keep "Sv" as the draft.
    const parts = text.split(',');
    addTags(parts.slice(0, -1));
    setDraft(parts[parts.length - 1]);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTags([draft]);
      setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <span className="mb-1 flex justify-between font-mono text-xs uppercase">
        <span>{label}</span>
        <span>
          {value.length}/{max}
        </span>
      </span>
      <div className="border-2 border-ink bg-cream p-2 focus-within:shadow-hard">
        <div className="flex flex-wrap items-center gap-2">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-2 border-2 border-ink bg-ink px-2 py-1 font-mono text-xs text-cream"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="cursor-pointer font-bold leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <input
            aria-label={label}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              addTags([draft]);
              setDraft('');
            }}
            maxLength={maxLength}
            disabled={full}
            placeholder={full ? 'Maximum reached' : 'Type, press Enter'}
            className="min-w-32 flex-1 bg-transparent px-1 py-1 font-mono text-sm placeholder:text-ink/50 focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
