import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
    I18N_CHECK_COMMAND,
    I18N_GENERATED_FILES,
    I18N_TEMPLATE_MARKER,
    I18N_TEMPLATE_VERSION,
    I18N_UPGRADE_COMMAND,
    I18N_UPGRADE_NOTICE,
    compareVersions,
    formatI18nUpgradeNotice,
    inspectI18nTemplates,
    readI18nTemplateVersion,
} from "../src/i18n-template-check.ts";

const tempDirs: string[] = [];

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "sveltia-i18n-check-"));
    tempDirs.push(dir);

    return dir;
}

function writeGenerated(cwd: string, version: string | null): void {
    for (const rel of I18N_GENERATED_FILES) {
        const target = join(cwd, rel);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(
            target,
            version === null
                ? "# unversioned legacy file\n"
                : `<!-- ${I18N_TEMPLATE_MARKER}${version} -->\n`,
        );
    }
}

describe("i18n template version source of truth", () => {
    it("matches the package version in package.json", () => {
        const pkg = JSON.parse(
            readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
        ) as { version: string };

        expect(I18N_TEMPLATE_VERSION).toBe(pkg.version);
    });

    it("compares dotted numeric versions", () => {
        expect(compareVersions("0.3.4", "0.3.5")).toBe(-1);
        expect(compareVersions("0.3.5", "0.3.5")).toBe(0);
        expect(compareVersions("0.4.0", "0.3.5")).toBe(1);
    });

    it("reads a stamped version and rejects foreign files", () => {
        expect(
            readI18nTemplateVersion(`# ${I18N_TEMPLATE_MARKER}0.3.4\nname: old\n`),
        ).toBe("0.3.4");
        expect(readI18nTemplateVersion("name: handwritten\n")).toBeNull();
    });

    it("publishes one canonical pnpm notice", () => {
        expect(I18N_UPGRADE_COMMAND).toBe("pnpm exec astro-sveltia-pages init:i18n");
        expect(I18N_CHECK_COMMAND).toBe(
            "pnpm exec astro-sveltia-pages init:i18n --check",
        );
        expect(I18N_UPGRADE_NOTICE).toContain(I18N_UPGRADE_COMMAND);
        expect(I18N_UPGRADE_NOTICE).not.toContain("npx");
    });
});

describe("inspectI18nTemplates", () => {
    it("reports i18n as disabled when none of the files exist", () => {
        const status = inspectI18nTemplates(makeTempDir());

        expect(status.enabled).toBe(false);
        expect(status.missing).toHaveLength(3);
        // `enabled: false` is what keeps the build-time check silent.
        expect(status.outdated).toBe(true);
    });

    it("passes when all files carry the current version", () => {
        const cwd = makeTempDir();
        writeGenerated(cwd, I18N_TEMPLATE_VERSION);

        expect(inspectI18nTemplates(cwd)).toMatchObject({
            enabled: true,
            outdated: false,
            missing: [],
            stale: [],
        });
    });

    it("flags unversioned legacy files", () => {
        const cwd = makeTempDir();
        writeGenerated(cwd, null);

        const status = inspectI18nTemplates(cwd);

        expect(status.outdated).toBe(true);
        expect(status.stale).toHaveLength(3);
        expect(status.stale[0]?.found).toBeNull();
    });

    it("flags outdated stamped files", () => {
        const cwd = makeTempDir();
        writeGenerated(cwd, "0.3.4");

        const status = inspectI18nTemplates(cwd);

        expect(status.outdated).toBe(true);
        expect(status.stale).toHaveLength(3);
        expect(status.stale[0]?.found).toBe("0.3.4");
    });

    it("formats an actionable notice with the exact fix commands", () => {
        const cwd = makeTempDir();
        writeGenerated(cwd, "0.3.4");
        const notice = formatI18nUpgradeNotice(inspectI18nTemplates(cwd));

        expect(notice).toContain(I18N_UPGRADE_NOTICE);
        expect(notice).toContain(I18N_UPGRADE_COMMAND);
        expect(notice).toContain(I18N_CHECK_COMMAND);
        expect(notice).toContain("你刚升级过 astro-sveltia-pages 吗");
        expect(notice).not.toContain("npx");
    });
});
