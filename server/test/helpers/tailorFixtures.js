// Shared fixtures for the tailoring tests: a profile, a job description and what a well-behaved
// model returns for it. Functions, so every test gets its own copy to change freely.

export const profile = () => ({
  basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '', location: 'Pune', links: [] },
  summary: 'Full-stack engineer.',
  education: [{ id: 'edu1', school: 'State University', degree: 'B.Sc. Computer Science', dates: '2017 - 2021', grade: '' }],
  experience: [
    {
      id: 'exp1',
      company: 'Acme Corp',
      role: 'Software Engineer',
      dates: '2021 - 2024',
      bullets: [
        { id: 'exp1_b1', text: 'Built a React dashboard used by 40 teams', skills: ['React'], alwaysInclude: false },
        { id: 'exp1_b2', text: 'Wrote Node.js services for the billing platform', skills: ['Node.js'], alwaysInclude: false },
        { id: 'exp1_b3', text: 'Cut API response time by 35% by adding caching', skills: ['Node.js'], alwaysInclude: false },
        { id: 'exp1_b4', text: 'Mentored two junior engineers', skills: [], alwaysInclude: false },
      ],
    },
    {
      id: 'exp2',
      company: 'Globex Inc',
      role: 'Intern',
      dates: '2020',
      bullets: [{ id: 'exp2_b1', text: 'Fixed bugs in the checkout flow', skills: ['JavaScript'], alwaysInclude: false }],
    },
  ],
  projects: [
    {
      id: 'proj1',
      name: 'NavTailor',
      link: '',
      skills: ['React', 'Node.js', 'MongoDB'],
      bullets: [
        { id: 'proj1_b1', text: 'Tailors resumes to a job description using an LLM', skills: [] },
        { id: 'proj1_b2', text: 'Stores profiles in MongoDB', skills: ['MongoDB'] },
      ],
    },
    {
      id: 'proj2',
      name: 'Weather CLI',
      link: '',
      skills: ['Python'],
      bullets: [{ id: 'proj2_b1', text: 'Prints the forecast in the terminal', skills: ['Python'] }],
    },
  ],
  certifications: [
    { id: 'cert1', name: 'AWS Cloud Practitioner', issuer: 'Amazon', year: '2023', skills: [] },
    { id: 'cert2', name: 'Scrum Master', issuer: 'Scrum.org', year: '2022', skills: [] },
  ],
  skills: { languages: ['JavaScript', 'Python'], frameworks: ['React', 'Node.js', 'Express'], tools: ['MongoDB', 'Git', 'Docker'] },
});

export const JOB_DESCRIPTION = `Initech is hiring a Backend Engineer.
You have strong experience with React and Node.js, and you know TypeScript and Kubernetes.
Nice to have: MongoDB and Docker. You will build microservices and practise stakeholder management.`;

// What a well-behaved model returns for JOB_DESCRIPTION (before grounding).
export const analysis = () => ({
  roleTitle: 'Backend Engineer',
  company: 'Initech',
  seniority: 'mid',
  requiredSkills: ['React', 'Node.js', 'TypeScript', 'Kubernetes'],
  preferredSkills: ['MongoDB', 'Docker'],
  keywords: ['microservices', 'stakeholder management'],
});

// Deep-freezes a value, to prove a function never changes its input.
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
