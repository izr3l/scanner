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
  { files: ['tests/**/*.mjs'], languageOptions: { globals: Object.fromEntries(['document','window','navigator','fetch','btoa','crypto','URL','Blob','trustedTypes','Worker','setTimeout','clearTimeout','location','performance','createImageBitmap','process','console'].map((name) => [name, 'readonly'])) } },
  globalIgnores(['.next/**', 'out/**', 'public/**', '.qa/**'])
]);
