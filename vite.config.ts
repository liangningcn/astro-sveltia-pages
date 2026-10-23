import { defineConfig } from "vite-plus";

// vite-plus's bundled tsdown honours `dts.resolve` at runtime, but its public
// type predates the option; keep a typed passthrough so `check` stays clean.
const dtsOptions = { tsgo: true, resolve: false } as never;

export default defineConfig({
    staged: { "*": "vp check --fix" },
    pack: {
        entry: {
            index: "./src/index.ts",
            loader: "./src/loader.ts",
            cli: "./src/cli.ts",
        },
        copy: [{ from: "templates", to: "dist" }],
        // Do not inline dependency types: `@sveltia/cms` pulls in `immutable`,
        // whose ambient .d.ts breaks dts bundling. The generated .d.ts keeps
        // `import("@sveltia/cms")` references instead, so the package stays a
        // runtime dependency for type resolution.
        dts: dtsOptions,
    },
    lint: {
        ignorePatterns: ["dist/**", "example/**"],
        rules: { curly: ["error", "all"], "no-nested-ternary": "error" },
        options: { typeAware: true, typeCheck: true },
    },
    fmt: {
        ignorePatterns: ["pnpm-lock.yaml", "example/src/content/**"],
        tabWidth: 4,
        useTabs: false,
        printWidth: 88,
        endOfLine: "lf",
        insertFinalNewline: true,
        trailingComma: "all",
        objectWrap: "collapse",
        bracketSameLine: false,
        htmlWhitespaceSensitivity: "css",
        proseWrap: "preserve",
        jsdoc: false,
        sortPackageJson: false,
        sortImports: {
            groups: [
                "builtin",
                "external",
                ["internal", "subpath"],
                ["parent", "sibling", "index"],
                "unknown",
            ],
            ignoreCase: false,
            order: "asc",
            newlinesBetween: true,
            sortSideEffects: false,
        },
    },
});
