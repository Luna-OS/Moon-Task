import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

// MoonTask ESLint configuration.
//
// Two rules here are not style preferences, they enforce a security
// boundary: the webview must never talk to the network directly (all data
// comes from Rust through src/lib/ipc.ts) and must never inject raw HTML
// (process names, command lines and environment variables are untrusted
// input and must stay escaped).
const noDirectNetworkAccess = {
  name: "moontask/no-direct-network-access",
  rules: {
    "no-restricted-globals": [
      "error",
      {
        name: "fetch",
        message:
          "MoonTask darf im Frontend keine eigenen Netzwerkaufrufe machen. Nutze einen Tauri-Command (siehe src/lib/ipc.ts).",
      },
      {
        name: "XMLHttpRequest",
        message:
          "MoonTask darf im Frontend keine eigenen Netzwerkaufrufe machen. Nutze einen Tauri-Command (siehe src/lib/ipc.ts).",
      },
      {
        name: "WebSocket",
        message: "MoonTask darf im Frontend keine eigenen Netzwerkverbindungen aufbauen.",
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message:
          "dangerouslySetInnerHTML is not allowed. Process names and command lines must always stay escaped.",
      },
    ],
  },
};

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "src-tauri/gen", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/consistent-type-imports": "error",
      // The process table is a native <table> promoted to an ARIA treegrid
      // (parent/child rows with aria-level/aria-expanded), which the
      // plugin's defaults only allow as a flat grid.
      "jsx-a11y/no-noninteractive-element-to-interactive-role": [
        "error",
        {
          ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
          ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
          li: ["menuitem", "option", "row", "tab", "treeitem"],
          table: ["grid", "treegrid"],
          td: ["gridcell"],
          fieldset: ["radiogroup", "presentation"],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  noDirectNetworkAccess,
  {
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettierConfig,
);
