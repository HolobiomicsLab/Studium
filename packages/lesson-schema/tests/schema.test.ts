import { describe, it, expect } from 'vitest';
import { validateLesson, loadSchema } from '../src/index.js';

const validSample = {
  schema_version: '1.0',
  id: 'lesson-test-001',
  title: 'Test lesson',
  language: 'fr',
  learning_objectives: [
    { id: 'obj-1', description: 'Comprendre les bases', bloom_level: 'understand' },
  ],
  scenes: [
    {
      id: 'scene-1',
      type: 'intro',
      objective_refs: ['obj-1'],
      modulators: [],
      content: { text: 'Bienvenue dans cette leçon.' },
      success_criteria: 'L\'étudiant a lu l\'introduction.',
      adaptation_hooks: [],
    },
  ],
  metadata: {
    subject: 'test',
    author: 'agent',
    created: '2026-05-05',
  },
};

describe('validateLesson', () => {
  it('returns {valid: false, errors: [...]} for an empty object', () => {
    const result = validateLesson({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('returns {valid: true, data: <Lesson>} for a valid sample', () => {
    const result = validateLesson(validSample);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as { schema_version: string }).schema_version).toBe('1.0');
  });
});

describe('loadSchema', () => {
  it('returns an object with $schema: "https://json-schema.org/draft/2020-12/schema"', () => {
    const schema = loadSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});
