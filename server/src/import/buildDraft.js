// Turns the LLM's validated output into a draft profile we are willing to show the user.
// Two jobs, both done in plain code so we never have to trust the model for them:
//   1. Ids: rewritten by position, so they are stable, unique and boring.
//   2. Grounding: anything that is not literally in the source text is dropped or flagged.
// Warnings never contain resume text, only a section name and a position.

// Lowercase, keep letters, digits and + # . (so "C++", "C#", "Node.js" survive), collapse the rest.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();

export function buildDraft(data, sourceText) {
  const warnings = [];
  const source = norm(sourceText);
  const sourceDigits = sourceText.replace(/\D/g, '');
  const has = (value) => value !== '' && source.includes(norm(value));

  const draft = structuredClone(data);
  // Optional sections: the schema defaults them, but a caller may hand us data without them.
  draft.achievements ??= [];
  draft.activities ??= [];
  draft.activitiesHeading ??= '';

  // --- grounding: basics ---
  const b = draft.basics;
  if (b.name && !has(b.name)) {
    b.name = '';
    warnings.push('basics.name was not found in the file and was cleared');
  }
  if (b.email && !has(b.email)) {
    b.email = '';
    warnings.push('basics.email was not found in the file and was cleared');
  }
  if (b.phone && !sourceDigits.includes(b.phone.replace(/\D/g, ''))) {
    b.phone = '';
    warnings.push('basics.phone was not found in the file and was cleared');
  }
  b.links = b.links.filter((link, i) => {
    const ok = source.includes(norm(link.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '')));
    if (!ok) warnings.push(`basics.links[${i}] was not found in the file and was removed`);
    return ok;
  });

  // Years in a date range must appear in the source, otherwise the whole field is cleared.
  const groundDates = (item, label) => {
    const years = item.dates.match(/\b(19|20)\d{2}\b/g) ?? [];
    if (years.some((y) => !sourceText.includes(y))) {
      item.dates = '';
      warnings.push(`${label}.dates contained a year not found in the file and was cleared`);
    }
  };

  // Skill tags must appear in the source text.
  const groundTags = (tags, label) =>
    tags.filter((tag, i) => {
      const ok = has(tag);
      if (!ok) warnings.push(`${label}[${i}] skill was not found in the file and was removed`);
      return ok;
    });

  // A number in a bullet (40%, 3x, $2M, 1,200) must appear in the source. Warn only: we do not
  // edit the user's sentence for them, but they see exactly which bullet to double-check.
  const NUMBER = /\$?\d[\d,.]*\s?(?:%|x\b|k\b|m\b|b\b)?/gi;
  const checkMetrics = (bullet, label) => {
    const missing = (bullet.text.match(NUMBER) ?? []).filter((n) => !sourceText.includes(n.trim()));
    if (missing.length) warnings.push(`${label} has a number that is not in the file; please check it`);
  };

  // --- education ---
  draft.education = draft.education.filter((e, i) => {
    if (e.school && !has(e.school)) {
      warnings.push(`education[${i}] school was not found in the file; entry removed`);
      return false;
    }
    groundDates(e, `education[${i}]`);
    // A grade is a claim about the person, so it must be written in the file.
    if (e.grade && !has(e.grade)) {
      e.grade = '';
      warnings.push(`education[${i}].grade was not found in the file and was cleared`);
    }
    return true;
  });

  // --- experience: an invented employer removes the whole entry ---
  draft.experience = draft.experience.filter((job, i) => {
    if (job.company && !has(job.company)) {
      warnings.push(`experience[${i}] company was not found in the file; entry removed`);
      return false;
    }
    return true;
  });
  draft.experience.forEach((job, i) => {
    groundDates(job, `experience[${i}]`);
    if (job.location && !has(job.location)) {
      job.location = '';
      warnings.push(`experience[${i}].location was not found in the file and was cleared`);
    }
    job.bullets.forEach((bullet, j) => {
      bullet.skills = groundTags(bullet.skills, `experience[${i}].bullets[${j}].skills`);
      bullet.alwaysInclude = false;
      checkMetrics(bullet, `experience[${i}].bullets[${j}]`);
    });
  });

  // --- projects, certifications, skills ---
  draft.projects.forEach((p, i) => {
    if (p.link && !has(p.link.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, ''))) {
      p.link = '';
      warnings.push(`projects[${i}].link was not found in the file and was cleared`);
    }
    // A tagline is the model's favourite place to invent a description, so it must be in the file.
    if (p.tagline && !has(p.tagline)) {
      p.tagline = '';
      warnings.push(`projects[${i}].tagline was not found in the file and was cleared`);
    }
    groundDates(p, `projects[${i}]`);
    p.skills = groundTags(p.skills, `projects[${i}].skills`);
    p.bullets.forEach((bullet, j) => {
      bullet.skills = groundTags(bullet.skills, `projects[${i}].bullets[${j}].skills`);
      checkMetrics(bullet, `projects[${i}].bullets[${j}]`);
    });
  });
  draft.certifications.forEach((c, i) => {
    c.skills = groundTags(c.skills, `certifications[${i}].skills`);
    if (c.year && !sourceText.includes(c.year)) {
      c.year = '';
      warnings.push(`certifications[${i}].year was not found in the file and was cleared`);
    }
  });
  // --- achievements and activities: an item not in the file is removed ---
  draft.achievements = draft.achievements.filter((a, i) => {
    if (a.text && !has(a.text)) {
      warnings.push(`achievements[${i}] was not found in the file; entry removed`);
      return false;
    }
    checkMetrics(a, `achievements[${i}]`);
    return true;
  });
  draft.activities = draft.activities.filter((a, i) => {
    if (a.title && !has(a.title)) {
      warnings.push(`activities[${i}] title was not found in the file; entry removed`);
      return false;
    }
    if (a.detail && !has(a.detail)) {
      a.detail = '';
      warnings.push(`activities[${i}].detail was not found in the file and was cleared`);
    }
    return true;
  });
  if (draft.activitiesHeading && !has(draft.activitiesHeading)) draft.activitiesHeading = '';

  for (const key of ['languages', 'frameworks', 'tools']) {
    draft.skills[key] = groundTags(draft.skills[key], `skills.${key}`);
  }

  // --- ids last, after entries were removed, so numbering has no gaps ---
  draft.education.forEach((e, i) => (e.id = `edu${i + 1}`));
  draft.experience.forEach((job, i) => {
    job.id = `exp${i + 1}`;
    job.bullets.forEach((bullet, j) => (bullet.id = `${job.id}_b${j + 1}`));
  });
  draft.projects.forEach((p, i) => {
    p.id = `proj${i + 1}`;
    p.bullets.forEach((bullet, j) => (bullet.id = `${p.id}_b${j + 1}`));
  });
  draft.certifications.forEach((c, i) => (c.id = `cert${i + 1}`));
  draft.achievements.forEach((a, i) => (a.id = `ach${i + 1}`));
  draft.activities.forEach((a, i) => (a.id = `act${i + 1}`));

  return { draft, warnings };
}
