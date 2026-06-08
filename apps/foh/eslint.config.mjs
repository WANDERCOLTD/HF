import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Design-system consistency: catch hardcoded hex colours in inline styles —
  // use CSS variables instead (see app/globals.css for available tokens).
  {
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(background|backgroundColor|color|borderColor|border)$/] Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Avoid hardcoded hex colours in inline styles. Use CSS variables instead (e.g. var(--surface-primary), var(--text-primary)). See app/globals.css for available tokens.",
        },
      ],
    },
  },
]);

export default eslintConfig;
