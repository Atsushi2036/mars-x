import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '.shots', 'public', 'node_modules', 'src/components/ui'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is forbidden (security policy).' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // three.js objects are mutated by design inside useFrame / effects
    files: ['src/scene/**/*.{ts,tsx}', 'src/ui/Joystick.tsx'],
    rules: { 'react-hooks/immutability': 'off', 'react-hooks/refs': 'off' },
  },
)
