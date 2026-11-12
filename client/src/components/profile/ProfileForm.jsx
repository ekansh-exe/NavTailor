import BasicsSection from './BasicsSection.jsx';
import EducationSection from './EducationSection.jsx';
import ExperienceSection from './ExperienceSection.jsx';
import ProjectsSection from './ProjectsSection.jsx';
import CertificationsSection from './CertificationsSection.jsx';
import SkillsSection from './SkillsSection.jsx';
import ActivitiesSection from './ActivitiesSection.jsx';
import AchievementsSection from './AchievementsSection.jsx';

// The profile sections, shared by the editor and the import review screen.
// `onChange(patch)` receives only the part that changed, e.g. { summary: "..." }.
export default function ProfileForm({ profile, onChange }) {
  return (
    <div className="space-y-8">
      <BasicsSection
        basics={profile.basics}
        summary={profile.summary}
        onBasicsChange={(basics) => onChange({ basics })}
        onSummaryChange={(summary) => onChange({ summary })}
      />
      <EducationSection items={profile.education} onChange={(education) => onChange({ education })} />
      <ExperienceSection items={profile.experience} onChange={(experience) => onChange({ experience })} />
      <ProjectsSection items={profile.projects} onChange={(projects) => onChange({ projects })} />
      <CertificationsSection
        items={profile.certifications}
        onChange={(certifications) => onChange({ certifications })}
      />
      <SkillsSection skills={profile.skills} onChange={(skills) => onChange({ skills })} />
      {/* Optional sections. ?? [] because a profile saved before they existed may not carry them. */}
      <ActivitiesSection
        heading={profile.activitiesHeading}
        items={profile.activities ?? []}
        onHeadingChange={(activitiesHeading) => onChange({ activitiesHeading })}
        onChange={(activities) => onChange({ activities })}
      />
      <AchievementsSection
        items={profile.achievements ?? []}
        onChange={(achievements) => onChange({ achievements })}
      />
    </div>
  );
}
