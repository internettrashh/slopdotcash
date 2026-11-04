import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createProfileDirectory, type ProfileIndex } from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { fixtureCheckout } from "../tests/fixture-checkout";
import { childEnvironment } from "./child-environment.mjs";

const targets = TARGET_REPOSITORIES.map((repository) => repository.id);
function census(repositories: string[]): ProfileIndex {
  return {
    schemaVersion: "2",
    startedAt: "2026-10-30T06:00:00.000Z",
    generatedAt: "2026-10-30T06:01:00.000Z",
    repositories: repositories.map((repository) => ({
      repository,
      count: 0,
      excluded: 0,
    })),
    people: [],
    issues: {
      firstObservedAt: "2026-10-30T06:00:00.000Z",
      repositories: repositories.map((repository) => ({
        repository,
        count: 0,
      })),
      items: [],
    },
  };
}

for (const inputKind of [
  "current",
  "outdated",
  "default-seed",
  "explicit-seed",
] as const) {
  test(`shared publication validates the selected profile census: ${inputKind}`, () => {
    const root = fixtureCheckout("publication-profiles-");
    try {
      // Keep the real profile CLI and registry. The other publication stages
      // do not affect this inventory check and need no generated artifacts.
      for (const path of [
        "scripts/prepare-site.mjs",
        "scripts/generate-points.ts",
        "scripts/generate-standings.ts",
        "scripts/prepare-leaderboard-transport.mjs",
      ])
        writeFileSync(join(root, path), "// unrelated publication stage\n");
      const seed =
        inputKind === "default-seed" || inputKind === "explicit-seed";
      const input = join(
        root,
        seed ? "data/profiles/seed.json" : "profile-input.json",
      );
      const output = join(root, "public/data/profiles.json");
      const directory = join(root, "public/data/profile-directory.json");
      const previous = `${JSON.stringify(census(targets))}\n`;
      const value = census(
        inputKind === "current" ? targets : targets.slice(1),
      );
      value.generatedAt = "2026-10-30T06:02:00.000Z";
      mkdirSync(join(root, "public/data"), { recursive: true });
      writeFileSync(output, previous);
      writeFileSync(input, JSON.stringify(value));
      const result = spawnSync(
        process.execPath,
        ["scripts/prepare-publication.mjs"],
        {
          cwd: root,
          env: childEnvironment(
            Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => key !== "SLOP_PROFILES_INPUT",
              ),
            ),
            inputKind === "default-seed" ? {} : { SLOP_PROFILES_INPUT: input },
          ),
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      if (inputKind !== "outdated") {
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(value);
        // The site reads the directory published from the same census.
        expect(JSON.parse(readFileSync(directory, "utf8"))).toEqual(
          createProfileDirectory(value),
        );
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          "Profile repository inventory mismatch",
        );
        expect(readFileSync(output, "utf8")).toBe(previous);
        expect(existsSync(directory)).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);
}
