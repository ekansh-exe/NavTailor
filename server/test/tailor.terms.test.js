// Tests for term and number matching (server/src/tailor/terms.js). Pure logic.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonKey, containsTerm, extractNumbers, hasNumber, sameTerm } from '../src/tailor/terms.js';

describe('containsTerm: boundaries', () => {
  test('"Java" is not found inside "JavaScript", and "JavaScript" is not "Java"', () => {
    assert.equal(containsTerm('Built it with JavaScript', 'Java'), false);
    assert.equal(containsTerm('Built it with Java', 'JavaScript'), false);
    assert.equal(containsTerm('Java and JavaScript', 'Java'), true);
  });
  test('"C" is not found inside "C++", "C#" or "etc."', () => {
    assert.equal(containsTerm('wrote C++ code', 'C'), false);
    assert.equal(containsTerm('wrote C# code', 'C'), false);
    assert.equal(containsTerm('tools, libraries etc.', 'C'), false);
    assert.equal(containsTerm('wrote C, Rust and Go', 'C'), true);
  });
  test('"C++" and "C#" are found as themselves', () => {
    assert.equal(containsTerm('wrote C++ code', 'C++'), true);
    assert.equal(containsTerm('wrote C# code', 'C#'), true);
    assert.equal(containsTerm('wrote C code', 'C++'), false);
  });
  test('short names that are also words need a capital: "Go" yes, "go" no', () => {
    assert.equal(containsTerm('Wrote Go services', 'Go'), true);
    assert.equal(containsTerm('ready to go live', 'Go'), false);
    assert.equal(containsTerm('Rewrote it in golang', 'Go'), true);
    assert.equal(containsTerm('R and Python', 'R'), true);
    assert.equal(containsTerm('R&D budget', 'R'), false);
  });
  test('a name at the end of a sentence still matches (Node.js.)', () => {
    assert.equal(containsTerm('We built it in Node.js.', 'Node.js'), true);
    assert.equal(containsTerm('We built it in Node.js, fast', 'node.js'), true);
  });
  test('punctuation inside a name is ignored on both sides (CI/CD)', () => {
    assert.equal(containsTerm('Set up CI/CD pipelines', 'CI/CD'), true);
    assert.equal(containsTerm('Set up ci cd pipelines', 'CI/CD'), true);
  });
  test('a plural and a singular find each other', () => {
    assert.equal(containsTerm('built microservices', 'microservice'), true);
    assert.equal(containsTerm('built a microservice', 'microservices'), true);
  });
  test('a term is not found inside a longer word', () => {
    assert.equal(containsTerm('reactive programming', 'React'), false);
    assert.equal(containsTerm('the gopher', 'Go'), false);
    assert.equal(containsTerm('anode', 'Node.js'), false);
  });
  test('empty text and empty terms do not match', () => {
    assert.equal(containsTerm('', 'React'), false);
    assert.equal(containsTerm('React', ''), false);
  });
});

describe('containsTerm: aliases', () => {
  test('different spellings of one thing find each other', () => {
    assert.equal(containsTerm('Used Postgres daily', 'PostgreSQL'), true);
    assert.equal(containsTerm('Used PostgreSQL daily', 'postgres'), true);
    assert.equal(containsTerm('Ran it on k8s', 'Kubernetes'), true);
    assert.equal(containsTerm('NodeJS apis', 'Node.js'), true);
    assert.equal(containsTerm('React.js apps', 'React'), true);
    assert.equal(containsTerm('Mongo queries', 'MongoDB'), true);
    assert.equal(containsTerm('Hosted on Amazon Web Services', 'AWS'), true);
  });
});

describe('containsTerm: guard mode (used only by the guardrail)', () => {
  test('words that are also tool names only count when capitalised', () => {
    assert.equal(containsTerm('react to feedback', 'React', { guard: true }), false);
    assert.equal(containsTerm('express interest', 'Express', { guard: true }), false);
    assert.equal(containsTerm('a spring release', 'Spring', { guard: true }), false);
    assert.equal(containsTerm('Built apps in React', 'React', { guard: true }), true);
    assert.equal(containsTerm('Node and Express apps', 'Express', { guard: true }), true);
  });
  test('scoring stays case-insensitive', () => {
    assert.equal(containsTerm('built react apps', 'React'), true);
  });
});

describe('sameTerm and canonKey', () => {
  test('aliases, case and plurals share an identity', () => {
    assert.ok(sameTerm('Postgres', 'PostgreSQL'));
    assert.ok(sameTerm('node', 'Node.js'));
    assert.ok(sameTerm('Microservices', 'microservice'));
    assert.ok(sameTerm('K8s', 'kubernetes'));
  });
  test('different things do not', () => {
    assert.ok(!sameTerm('Java', 'JavaScript'));
    assert.ok(!sameTerm('C', 'C++'));
    assert.ok(!sameTerm('React', 'Redux'));
  });
  test('"aws" is not shortened like a plural', () => {
    assert.equal(canonKey('AWS'), 'aws');
    assert.equal(canonKey('class'), 'class');
  });
});

describe('extractNumbers', () => {
  const cases = [
    ['Cut costs by 40% and saved $2M', ['40%', '2m']],
    ['1,200 users', ['1200']],
    ['3x faster', ['3x']],
    ['2.5 hours', ['2.5']],
    ['2.0 hours', ['2']],
    ['40 percent', ['40%']],
    ['10 million requests', ['10m']],
    ['40 thousand users', ['40k']],
    ['2021 - 2024', ['2021', '2024']],
    ['Python 3.11', ['3.11']],
    ['no numbers here', []],
  ];
  for (const [text, expected] of cases) {
    test(`${JSON.stringify(text)} -> ${JSON.stringify(expected)}`, () => assert.deepEqual(extractNumbers(text), expected));
  }
  test('a trailing full stop is not part of the number', () => {
    assert.deepEqual(extractNumbers('Cut errors by 40.'), ['40']);
    assert.deepEqual(extractNumbers('Served 40 teams.'), ['40']);
  });
  test('digits inside names are ignored (S3, EC2, k8s, Python3, i18n)', () => {
    assert.deepEqual(extractNumbers('S3, EC2, k8s, Python3 and i18n'), []);
  });
  test('number words count, and equal their digits', () => {
    assert.deepEqual(extractNumbers('two services'), ['2']);
    assert.deepEqual(extractNumbers('a dozen'), ['12']);
    assert.deepEqual(extractNumbers('hundreds of users'), ['hundreds']);
    assert.deepEqual(extractNumbers('zero downtime'), ['0']);
    assert.deepEqual(extractNumbers('double the speed'), ['double']);
  });
  test('"one" is not counted (it is too common in ordinary sentences)', () => {
    assert.deepEqual(extractNumbers('one of the best, no one knew'), []);
  });
  test('"40 thousand" is one number, not "40k" plus the word "thousand"', () => {
    assert.deepEqual(extractNumbers('40 thousand users'), ['40k']);
  });
  test('hasNumber', () => {
    assert.equal(hasNumber('Built a dashboard'), false);
    assert.equal(hasNumber('Built 3 dashboards'), true);
    assert.equal(hasNumber('Built two dashboards'), true);
  });
});
