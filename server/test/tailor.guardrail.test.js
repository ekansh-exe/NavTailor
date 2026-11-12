// Unit tests for the guardrail (server/src/tailor/guardrail.js). Pure functions: no network, no
// database, no model. Each test feeds a rewrite a model might produce and checks the verdict.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRewrites,
  buildVocabulary,
  checkRewrite,
  findNewNumbers,
  findNewTerms,
  isTooLong,
} from '../src/tailor/guardrail.js';
import { analysis, deepFreeze, profile } from './helpers/tailorFixtures.js';

const P = deepFreeze(profile());
const A = deepFreeze(analysis());
const VOCAB = buildVocabulary({ profile: P, analysis: A });
const PROFILE_SKILLS = [...P.skills.languages, ...P.skills.frameworks, ...P.skills.tools];

// Check one rewrite of the "dashboard" bullet, the way the pipeline would.
const ORIGINAL = 'Built a React dashboard used by 40 teams';
const check = (rewritten, original = ORIGINAL, itemSkills = ['React']) =>
  checkRewrite({ original, rewritten, itemSkills, profileSkills: PROFILE_SKILLS, vocabulary: VOCAB });

// ---------- the four cases that matter most ----------

describe('a correct rewrite', () => {
  test('is accepted', () => {
    const v = check('Developed a React dashboard adopted by 40 teams');
    assert.deepEqual(v, { accepted: true, reason: 'ok' });
  });
  test('may use the job\'s loose keywords, because that is what rewording for a job is', () => {
    const v = check('Built Node.js microservices for the billing platform', 'Wrote Node.js services for the billing platform', ['Node.js']);
    assert.equal(v.accepted, true, JSON.stringify(v));
  });
  test('may change case and keep every number', () => {
    assert.equal(check('built a react dashboard used by 40 teams').accepted, true);
  });
  test('may write a number differently: "forty" for 40', () => {
    assert.equal(check('Built a React dashboard used by forty teams').accepted, true);
  });
  test('may drop words and keep the facts', () => {
    assert.equal(check('Built a React dashboard for 40 teams').accepted, true);
  });
});

describe('an invented number', () => {
  test('a different number is rejected', () => {
    const v = check('Built a React dashboard used by 400 teams');
    assert.equal(v.accepted, false);
    assert.equal(v.reason, 'new_number');
    assert.deepEqual(v.offending, ['400']);
  });
  test('a brand-new metric is rejected', () => {
    const v = check('Built a React dashboard used by 40 teams, improving retention by 25%');
    assert.equal(v.reason, 'new_number');
    assert.deepEqual(v.offending, ['25%']);
  });
  test('a spelled-out number that is new is rejected', () => {
    assert.equal(check('Built a React dashboard used by dozens of teams').reason, 'new_number');
    assert.equal(check('Built a React dashboard used by three teams').reason, 'new_number');
  });
  test('vague quantity claims that sound like numbers are rejected', () => {
    for (const claim of ['hundreds of teams', 'zero downtime', 'thousands of users', 'double the speed']) {
      assert.equal(check(`Built a React dashboard with ${claim}`).reason, 'new_number', claim);
    }
  });
  test('a number must not change its unit: 40% is not 40x', () => {
    const v = check('Cut load time by 40x', 'Cut load time by 40%');
    assert.equal(v.reason, 'new_number');
  });
  test('the same number written another way is not new', () => {
    assert.deepEqual(findNewNumbers('Saved $2M and 1,200 hours', 'Saved 2 million and 1200 hours'), []);
    assert.deepEqual(findNewNumbers('Improved speed by 40%', 'Improved speed by 40 percent.'), []);
  });
  test('a full stop after a number is not part of the number', () => {
    assert.deepEqual(findNewNumbers('Served 40 teams', 'Served 40 teams.'), []);
    assert.deepEqual(findNewNumbers('Cut errors by 40.', 'Cut errors by 40'), []);
  });
  test('digits inside names (S3, EC2, k8s) are not numbers', () => {
    assert.deepEqual(findNewNumbers('Stored files in S3', 'Stored files in S3 and EC2'), []);
  });
  test('a year that is not in the original is a new number', () => {
    assert.equal(check('Built a React dashboard used by 40 teams in 2023').reason, 'new_number');
  });
  test('numbers are checked before names, so the reason is new_number', () => {
    assert.equal(check('Built a Kubernetes dashboard used by 41 teams').reason, 'new_number');
  });
});

describe('an invented technology', () => {
  test('a job-description skill the user does not have is rejected (the main temptation)', () => {
    const v = check('Built a React and Kubernetes dashboard used by 40 teams');
    assert.equal(v.accepted, false);
    assert.equal(v.reason, 'new_term');
    assert.deepEqual(v.offending, ['Kubernetes']);
  });
  test('a technology from the model\'s own memory is rejected (known-tech list)', () => {
    const v = check('Built a React dashboard used by 40 teams, deployed with Terraform');
    assert.equal(v.reason, 'new_term');
    assert.ok(v.offending.includes('Terraform'));
  });
  test('a name nobody has heard of is rejected (name-shaped net)', () => {
    const v = check('Built a React dashboard used by 40 teams using Zorbify');
    assert.equal(v.reason, 'new_term');
    assert.ok(v.offending.includes('Zorbify'));
  });
  test('a CamelCase or ALL-CAPS name is rejected', () => {
    assert.equal(check('Built a React dashboard used by 40 teams with FooBarDB').reason, 'new_term');
    assert.equal(check('Built a React dashboard used by 40 teams on XYZ').reason, 'new_term');
  });
  test('a name with a dot or a plus is rejected', () => {
    assert.equal(check('Built a React dashboard used by 40 teams with vault.io').reason, 'new_term');
    assert.equal(check('Built a React dashboard used by 40 teams in Zig++').reason, 'new_term');
  });
  test('another employer\'s name is rejected (a name must not hop between jobs)', () => {
    const v = check('Built a React dashboard used by 40 teams at Globex Inc');
    assert.equal(v.reason, 'new_term');
    assert.ok(v.offending.includes('Globex Inc'));
  });
  test('the job\'s company is rejected: you did not work there', () => {
    assert.equal(check('Built a React dashboard used by 40 teams for Initech').reason, 'new_term');
  });
  test('a skill that belongs to a DIFFERENT item is rejected when it is not in the profile skills', () => {
    const profileSkills = ['React'];
    const v = checkRewrite({
      original: ORIGINAL,
      rewritten: 'Built a React dashboard used by 40 teams with Redis',
      itemSkills: ['React'],
      profileSkills,
      vocabulary: [...VOCAB, 'Redis'],
    });
    assert.equal(v.reason, 'new_term');
  });
  test('typographic tricks do not hide a name: case, plural, alias', () => {
    assert.equal(check('Built a React dashboard used by 40 teams on KUBERNETES').reason, 'new_term');
    assert.equal(check('Built a React dashboard used by 40 teams on k8s').reason, 'new_term');
    assert.equal(check('Built a React dashboard used by 40 teams on docker').accepted, true); // Docker is in the profile skills
  });

  describe('names that ARE allowed', () => {
    test('one written in the original bullet', () => {
      const v = check('Built a Redis cache for 40 teams', 'Built a Redis cache used by 40 teams', []);
      assert.equal(v.accepted, true, JSON.stringify(v));
    });
    test('one in the same item\'s skills', () => {
      assert.equal(check('Built a React dashboard used by 40 teams with Node.js', ORIGINAL, ['React', 'Node.js']).accepted, true);
    });
    test('one in the profile\'s skills list, even if this bullet never used it (the guide allows it)', () => {
      assert.equal(check('Built a React dashboard used by 40 teams on MongoDB').accepted, true);
    });
    test('an alias of an allowed name (Postgres for PostgreSQL)', () => {
      const v = checkRewrite({
        original: 'Tuned PostgreSQL queries',
        rewritten: 'Tuned Postgres queries',
        itemSkills: [],
        profileSkills: [],
        vocabulary: ['PostgreSQL'],
      });
      assert.equal(v.accepted, true, JSON.stringify(v));
    });
    test('everyday words that are also tool names are fine in lower case', () => {
      const v = check('Learned to react quickly and express ideas to 40 teams', 'Learned to respond and communicate with 40 teams', []);
      assert.equal(v.accepted, true, JSON.stringify(v));
    });
    test('a normal capitalised sentence start is fine', () => {
      assert.equal(check('Delivered a React dashboard used by 40 teams').accepted, true);
    });
    test('generic abbreviations are fine (API, UI, CI/CD)', () => {
      const v = check('Built a React UI used by 40 teams through CI/CD and an API', ORIGINAL, ['React']);
      assert.equal(v.accepted, true, JSON.stringify(v));
    });
  });
});

describe('length', () => {
  test('a modest change is fine', () => {
    assert.equal(isTooLong(ORIGINAL, `${ORIGINAL} quickly`), false);
  });
  test('growing by more than a quarter is rejected', () => {
    const v = check(`${ORIGINAL} and also reviewed code written by many other people on the team every single week`);
    assert.equal(v.reason, 'too_long');
  });
  test('nothing above 500 characters is ever accepted', () => {
    assert.equal(isTooLong('x'.repeat(480), 'x'.repeat(501)), true);
  });
  test('a very short original gets a little room', () => {
    assert.equal(isTooLong('Fixed bugs', 'Resolved defects quickly'), false);
  });
});

describe('empty and identical rewrites', () => {
  test('blank text is rejected', () => {
    for (const blank of ['', '   ', '\n\t']) assert.equal(check(blank).reason, 'empty');
  });
  test('the same text (even with different spacing) is "unchanged" and accepted', () => {
    assert.deepEqual(check('  Built a React   dashboard used by 40 teams '), { accepted: true, reason: 'unchanged' });
  });
});

// ---------- the pieces ----------

describe('findNewTerms', () => {
  test('returns the offending names and nothing for a clean rewrite', () => {
    const base = { original: ORIGINAL, itemSkills: ['React'], profileSkills: PROFILE_SKILLS, vocabulary: VOCAB };
    assert.deepEqual(findNewTerms({ ...base, rewritten: 'Built a React dashboard used by 40 teams' }), []);
    assert.ok(findNewTerms({ ...base, rewritten: 'Built a React dashboard with Terraform and Ansible' }).length >= 2);
  });
  test('reports at most 10 names', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Zzz${String.fromCharCode(65 + (i % 26))}Q${i}Db`).join(' and ');
    assert.ok(findNewTerms({ original: 'x', rewritten: `Built ${many}`, vocabulary: [] }).length <= 10);
  });
});

describe('buildVocabulary', () => {
  test('holds the job\'s required and preferred skills and its company', () => {
    for (const name of ['Kubernetes', 'TypeScript', 'MongoDB', 'Docker', 'Initech']) assert.ok(VOCAB.includes(name), name);
  });
  test('holds every company and skill tag in the profile', () => {
    for (const name of ['Acme Corp', 'Globex Inc', 'Amazon', 'Express', 'Python']) assert.ok(VOCAB.includes(name), name);
  });
  test('holds the common technologies the model might invent', () => {
    for (const name of ['Terraform', 'Ansible', 'Kafka']) assert.ok(VOCAB.includes(name), name);
  });
  test('leaves out the job\'s loose keywords (using them is the point of a rewrite)', () => {
    assert.ok(!VOCAB.includes('microservices'));
    assert.ok(!VOCAB.includes('stakeholder management'));
  });
  test('has no duplicates, aliases included', () => {
    const vocab = buildVocabulary({
      profile: { ...P, skills: { languages: [], frameworks: [], tools: ['PostgreSQL', 'Postgres'] } },
      analysis: { ...A, requiredSkills: ['postgresql'], preferredSkills: [] },
    });
    assert.equal(vocab.filter((n) => /^postgres/i.test(n)).length, 1);
  });
});

// ---------- all the rewrites together ----------

describe('applyRewrites', () => {
  const bullets = new Map([
    ['exp1_b1', { text: 'Built a React dashboard used by 40 teams', skills: ['React'] }],
    ['exp1_b2', { text: 'Wrote Node.js services for the billing platform', skills: ['Node.js'] }],
    ['exp1_b3', { text: 'Cut API response time by 35% by adding caching', skills: ['Node.js'] }],
    ['exp2_b1', { text: 'Fixed bugs in the checkout flow', skills: ['JavaScript'] }], // real, but not selected below
  ]);
  const selectedIds = ['exp1_b1', 'exp1_b2', 'exp1_b3'];
  const run = (rewrites) => applyRewrites({ bullets, selectedIds, rewrites, profileSkills: PROFILE_SKILLS, vocabulary: VOCAB });
  const byId = (changes, id) => changes.find((c) => c.itemId === id);

  test('a correct rewrite is accepted and has the promised shape', () => {
    const changes = run([{ id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' }]);
    assert.deepEqual(byId(changes, 'exp1_b1'), {
      itemId: 'exp1_b1',
      original: 'Built a React dashboard used by 40 teams',
      rewritten: 'Developed a React dashboard adopted by 40 teams',
      accepted: true,
      reason: 'ok',
    });
  });

  test('an invented number is rejected: the original stays and the reason says why', () => {
    const change = byId(run([{ id: 'exp1_b3', text: 'Cut API response time by 53% by adding caching' }]), 'exp1_b3');
    assert.equal(change.accepted, false);
    assert.equal(change.reason, 'new_number');
    assert.deepEqual(change.offending, ['53%']);
    assert.equal(change.original, 'Cut API response time by 35% by adding caching');
    assert.equal(change.rewritten, 'Cut API response time by 53% by adding caching'); // what the model proposed
  });

  test('an invented technology is rejected', () => {
    const change = byId(run([{ id: 'exp1_b2', text: 'Wrote Node.js and Kubernetes services for the billing platform' }]), 'exp1_b2');
    assert.equal(change.accepted, false);
    assert.equal(change.reason, 'new_term');
    assert.deepEqual(change.offending, ['Kubernetes']);
  });

  test('an unknown id is discarded: reported as rejected, original empty, nothing else affected', () => {
    const changes = run([
      { id: 'exp999', text: 'Led a team of 50 people' },
      { id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' },
    ]);
    const unknown = byId(changes, 'exp999');
    assert.deepEqual(unknown, { itemId: 'exp999', original: '', rewritten: 'Led a team of 50 people', accepted: false, reason: 'unknown_id' });
    assert.equal(byId(changes, 'exp1_b1').accepted, true);
    assert.equal(changes.filter((c) => c.itemId === 'exp999').length, 1);
  });

  test('a real id that was not selected for the page is not applied either', () => {
    const change = byId(run([{ id: 'exp2_b1', text: 'Resolved defects in the checkout flow' }]), 'exp2_b1');
    assert.equal(change.accepted, false);
    assert.equal(change.reason, 'not_selected');
    assert.equal(change.original, 'Fixed bugs in the checkout flow');
  });

  test('a selected bullet the model skipped keeps its original and says so', () => {
    const change = byId(run([]), 'exp1_b2');
    assert.deepEqual(change, {
      itemId: 'exp1_b2',
      original: 'Wrote Node.js services for the billing platform',
      rewritten: 'Wrote Node.js services for the billing platform',
      accepted: false,
      reason: 'no_rewrite',
    });
  });

  test('an identical rewrite is "unchanged" and accepted', () => {
    const change = byId(run([{ id: 'exp1_b1', text: 'Built a React dashboard used by 40 teams' }]), 'exp1_b1');
    assert.equal(change.reason, 'unchanged');
    assert.equal(change.accepted, true);
  });

  test('the first rewrite of an id wins; later ones are ignored', () => {
    const changes = run([
      { id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' },
      { id: 'exp1_b1', text: 'Built a Kubernetes dashboard used by 99 teams' },
    ]);
    assert.equal(changes.filter((c) => c.itemId === 'exp1_b1').length, 1);
    assert.equal(byId(changes, 'exp1_b1').accepted, true);
  });

  test('one bad rewrite does not affect a good one', () => {
    const changes = run([
      { id: 'exp1_b1', text: 'Built a React dashboard used by 400 teams' },
      { id: 'exp1_b2', text: 'Built Node.js services for the billing platform' },
    ]);
    assert.equal(byId(changes, 'exp1_b1').accepted, false);
    assert.equal(byId(changes, 'exp1_b2').accepted, true);
  });

  test('changes come in page order, with unusable ids at the end', () => {
    const changes = run([
      { id: 'zzz', text: 'x' },
      { id: 'exp1_b3', text: 'Cut API response time by 35% through caching' },
    ]);
    assert.deepEqual(changes.map((c) => c.itemId), ['exp1_b1', 'exp1_b2', 'exp1_b3', 'zzz']);
  });

  test('it never changes its input (all inputs are frozen)', () => {
    const rewrites = deepFreeze([{ id: 'exp1_b1', text: 'Developed a React dashboard adopted by 40 teams' }]);
    assert.doesNotThrow(() =>
      applyRewrites({
        bullets: deepFreeze(new Map([...bullets])),
        selectedIds: deepFreeze([...selectedIds]),
        rewrites,
        profileSkills: deepFreeze([...PROFILE_SKILLS]),
        vocabulary: deepFreeze([...VOCAB]),
      }),
    );
  });

  test('every accepted:false change leaves the original as the text to use', () => {
    const changes = run([
      { id: 'exp1_b1', text: 'Built a React dashboard used by 400 teams' },
      { id: 'exp1_b2', text: 'Wrote Node.js services for the billing platform and Terraform' },
    ]);
    for (const change of changes.filter((c) => !c.accepted && c.original)) {
      assert.ok(bullets.get(change.itemId).text === change.original);
    }
  });
});
