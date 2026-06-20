import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import schemaJson from './schema.json' with { type: 'json' };

// ajv-formats is CJS with only a default export; under NodeNext the default import
// is typed as the module namespace, so reach through `.default` for the plugin fn
// (which is the same callable at both type-check and runtime).
const addFormats = addFormatsModule.default;

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schemaJson);

export type ValidationResult<T = unknown> =
  | { valid: true; data: T }
  | { valid: false; errors: import('ajv').ErrorObject[] };

export function validateLesson(data: unknown): ValidationResult {
  const ok = validate(data);
  if (ok) {
    return { valid: true, data };
  }
  return { valid: false, errors: validate.errors ?? [] };
}

export function loadSchema(): typeof schemaJson {
  return schemaJson;
}
