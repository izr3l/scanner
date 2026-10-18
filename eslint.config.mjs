import { defineConfig, globalIgnores } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  eslint.configs.recommended, ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: reactHooks.configs.recommended.rules },
  { rules: {
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/refs': 'off',
    'no-eval': 'error', 'no-new-func': 'error',
    'no-restricted-syntax': ['error', { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'HTML injection is prohibited.' }]
  } },
  { files: ['lib/export/index.ts'], rules: { 'no-control-regex': 'off' } },
  globalIgnores(['.next/**', 'out/**', 'public/**'])
]);
