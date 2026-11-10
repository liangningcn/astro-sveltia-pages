/**
 * Shared i18n configuration parsing — the single source of truth for both
 * `src/cli.ts` and the CI validator embedded in `templates/i18n/i18n-translate.yml`.
 *
 * `scripts/build-templates.mjs` strips the TypeScript types and the trailing
 * `export { ... }` line, then injects these functions verbatim into the workflow.
 * Keep this file dependency-free and side-effect free: no imports, no fs, no I/O.
 */

type I18nParseResult = {
    ok: boolean;
    locales: string[];
    defaultLocale: string;
    structure: string;
    error: string;
};

type InlineBlockResult = {
    status: "ok" | "variable-reference" | "not-found" | "unparseable";
    block: string;
};

const LANGUAGE_SHAPE = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/i;

function stripConfigComments(text: string): string {
    let out = "";
    let quote = "";

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1] ?? "";

        if (quote) {
            out += char;

            if (char === "\\") {
                out += next;
                i += 1;
            } else if (char === quote) {
                quote = "";
            }

            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            out += char;
            continue;
        }

        if (
            char === "#" &&
            (out.length === 0 || /\s/.test(out[out.length - 1] ?? ""))
        ) {
            while (i < text.length && text[i] !== "\n") {
                i += 1;
            }
            out += "\n";
            continue;
        }

        if (char === "/" && next === "/") {
            while (i < text.length && text[i] !== "\n") {
                i += 1;
            }
            out += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            i += 2;

            while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
                i += 1;
            }

            i += 1;
            out += " ";
            continue;
        }

        out += char;
    }

    return out;
}

/** Returns the contents of the first `locales: [...]` list (bracket-balanced). */
function extractLocalesBlock(text: string): string | null {
    const match = /(?<![\w])locales\s*:\s*\[/.exec(text);

    if (!match) {
        return null;
    }

    const start = match.index + match[0].length - 1;
    let depth = 0;
    let quote = "";

    for (let i = start; i < text.length; i += 1) {
        const char = text[i];

        if (quote) {
            if (char === "\\") {
                i += 1;
                continue;
            }

            if (char === quote) {
                quote = "";
            }

            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === "[") {
            depth += 1;
        } else if (char === "]") {
            depth -= 1;

            if (depth === 0) {
                return text.slice(start + 1, i);
            }
        }
    }

    return null;
}

function extractLocales(text: string): string[] {
    const block = extractLocalesBlock(text);

    if (block === null) {
        return [];
    }

    // Object form: locales: [{ locale: 'en', label: 'English' }, ...].
    const objectKeys = [
        ...block.matchAll(/(?<![\w])locale\s*:\s*['"]?([\w-]+)['"]?/g),
    ].map((match) => match[1]);

    if (objectKeys.length > 0) {
        return [...new Set(objectKeys)];
    }

    // A list of objects without `locale:` keys is not a language list.
    if (block.includes("{")) {
        return [];
    }

    const quoted = [
        ...new Set([...block.matchAll(/['"]([\w-]+)['"]/g)].map((match) => match[1])),
    ];

    if (quoted.length > 0) {
        return quoted;
    }

    // YAML bare array: locales: [en, es, fr] (config.yml projects). Only
    // language-shaped tokens survive, so stray words cannot leak in.
    return [
        ...new Set(
            block
                .split(/[^A-Za-z0-9_-]+/)
                .filter((token) => LANGUAGE_SHAPE.test(token)),
        ),
    ];
}

function extractDefaultLocale(text: string): string {
    const match = text.match(/default_locale:\s*['"]?([\w-]+)['"]?/);
    return match ? match[1] : "";
}

function extractStructure(text: string): string {
    const match = text.match(
        /structure:\s*['"]?(multiple_folders|single_file|multiple_files)['"]?/,
    );
    return match ? match[1] : "multiple_folders";
}

/**
 * Local names bound to this integration's default import. Consumers often
 * rename it (`import cms from "astro-sveltia-pages"`), so matching only the
 * literal `sveltia(` would silently miss those repositories.
 */
function integrationNames(text: string): string[] {
    const names = new Set<string>(["sveltia"]);
    const pattern =
        /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s*["']astro-sveltia-pages["']/g;

    for (const match of text.matchAll(pattern)) {
        names.add(match[1]);
    }

    return [...names];
}

/** Reads a `{...}` object literal starting at `openIndex`. */
function balancedObject(text: string, openIndex: number): string | null {
    let depth = 0;
    let quote = "";

    for (let i = openIndex; i < text.length; i += 1) {
        const char = text[i];

        if (quote) {
            if (char === "\\") {
                i += 1;
                continue;
            }

            if (char === quote) {
                quote = "";
            }

            continue;
        }

        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            continue;
        }

        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;

            if (depth === 0) {
                return text.slice(openIndex + 1, i);
            }
        }
    }

    return null;
}

/**
 * Isolates the inline `sveltia({...})` options object. Anything that cannot be
 * resolved statically (a variable argument, spread, conditional) is reported
 * rather than guessed — a wrong target-language list silently produces zero
 * translations in CI.
 */
function extractInlineSveltiaBlock(text: string): InlineBlockResult {
    const names = integrationNames(text)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    const call = new RegExp(`(?<![\\w$.])(${names})\\s*\\(`, "g");
    let sawVariableReference = false;

    for (const match of text.matchAll(call)) {
        let cursor = match.index + match[0].length;

        while (cursor < text.length && /\s/.test(text[cursor])) {
            cursor += 1;
        }

        if (text[cursor] !== "{") {
            sawVariableReference = true;
            continue;
        }

        const block = balancedObject(text, cursor);

        if (block === null || /\.\.\./.test(block)) {
            return { status: "unparseable", block: "" };
        }

        return { status: "ok", block };
    }

    if (sawVariableReference) {
        return { status: "variable-reference", block: "" };
    }

    return { status: "not-found", block: "" };
}

function parseFailure(error: string): I18nParseResult {
    return {
        ok: false,
        locales: [],
        defaultLocale: "",
        structure: "multiple_folders",
        error,
    };
}

function parseI18nConfig(text: string, isAstroConfig: boolean): I18nParseResult {
    const clean = stripConfigComments(text);
    let scope = clean;

    if (isAstroConfig) {
        const inline = extractInlineSveltiaBlock(clean);

        if (inline.status === "not-found") {
            return parseFailure("文件中没有 sveltia() 集成调用");
        }

        if (inline.status === "variable-reference") {
            return parseFailure(
                "sveltia() 的参数是变量引用（如 sveltia(options)），静态解析无法读取 i18n.locales",
            );
        }

        if (inline.status === "unparseable") {
            return parseFailure(
                "sveltia({...}) 含展开运算符或条件表达式，静态解析无法保证正确",
            );
        }

        scope = inline.block;
    }

    const locales = extractLocales(scope);

    if (locales.length === 0) {
        return parseFailure(
            isAstroConfig
                ? "无法从 sveltia({...}) 中解析出 i18n.locales（必须写成字面量数组）"
                : '未能从配置解析出 locales（需要 locales: [...] 或 locales: [{ locale: "en" }]）',
        );
    }

    return {
        ok: true,
        locales,
        defaultLocale: extractDefaultLocale(scope),
        structure: extractStructure(scope),
        error: "",
    };
}

/** One error string for both the CLI and the CI validator. */
function describeParseError(result: I18nParseResult, configPath: string): string {
    return (
        `无法解析 i18n 配置（${configPath}）：${result.error}。\n` +
        "      请用 --config <path> 指向实际的 Sveltia 配置文件，或把 i18n.locales 写成字面量数组。"
    );
}

function parseLocaleList(value: string): string[] {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function localeKey(value: string): string {
    return value.trim().toLowerCase();
}

/** Union that keeps the first-seen casing but compares case-insensitively. */
function unionLocales(...groups: string[][]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const group of groups) {
        for (const lang of group) {
            const value = lang.trim();

            if (!value || seen.has(localeKey(value))) {
                continue;
            }

            seen.add(localeKey(value));
            result.push(value);
        }
    }

    return result;
}

/**
 * The single rule used by both the CLI and the CI validator. Explicit
 * `--locales` wins outright; otherwise config + on-disk detections are merged.
 * Region variants (zh-CN vs zh) stay distinct; only casing is normalized.
 */
function computeTargetLangs(options: {
    configLocales: string[];
    detectedLangs: string[];
    explicitLocales: string[];
    defaultLocale: string;
}): string[] {
    const source = options.explicitLocales.length
        ? options.explicitLocales
        : unionLocales(options.configLocales, options.detectedLangs);
    const defaultKey = localeKey(options.defaultLocale || "en");

    return source
        .filter((lang) => localeKey(lang) !== defaultKey)
        .sort((a, b) => localeKey(a).localeCompare(localeKey(b)));
}

/** Two-way difference between declared locales and on-disk language folders. */
function diffLocales(
    configLocales: string[],
    detectedLangs: string[],
    defaultLocale: string,
): { declaredMissing: string[]; undeclared: string[] } {
    const declared = new Set(configLocales.map(localeKey));
    const detected = new Set(detectedLangs.map(localeKey));
    const defaultKey = localeKey(defaultLocale || "en");

    return {
        declaredMissing: configLocales.filter(
            (lang) => localeKey(lang) !== defaultKey && !detected.has(localeKey(lang)),
        ),
        undeclared: detectedLangs.filter(
            (lang) => localeKey(lang) !== defaultKey && !declared.has(localeKey(lang)),
        ),
    };
}

export {
    computeTargetLangs,
    describeParseError,
    diffLocales,
    extractDefaultLocale,
    extractInlineSveltiaBlock,
    extractLocales,
    extractStructure,
    integrationNames,
    localeKey,
    parseI18nConfig,
    parseLocaleList,
    stripConfigComments,
    unionLocales,
};
