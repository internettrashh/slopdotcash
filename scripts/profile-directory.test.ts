/**
 * The contributor and leaderboard pages read the published profile
 * directory instead of the complete census, whose issue history is only the
 * retained input of the next collection (PRD section 9).
 */
import { expect, test } from "bun:test";
import {
  assertProfileDirectory,
  assertProfiles,
  createProfileDirectory,
  PROFILE_DIRECTORY_FORMAT,
  type ProfileIndex,
} from "../src/lib/profiles";
import { TARGET_REPOSITORIES } from "../src/lib/repositories.mjs";
import { assertRetainedProfiles } from "./published-profiles";

const targets = TARGET_REPOSITORIES.map((repository) => repository.id);
const AUTHOR = "MDQ6VXNlcjEyMzQ1Njc=";

/** A complete census: two people, their counts and one closed issue. */
function census(): ProfileIndex {
  return {
    schemaVersion: "2",
    startedAt: "2026-10-30T06:00:00.000Z",
    generatedAt: "2026-10-30T06:01:00.000Z",
    repositories: targets.map((repository, index) => ({
      repository,
      count: index === 0 ? 7 : 0,
      excluded: index === 0 ? 1 : 0,
    })),
    people: [
      {
        id: AUTHOR,
        login: "issue-author",
        avatarUrl: "https://avatars.githubusercontent.com/u/1234567?v=4",
        repositories: [
          { repository: targets[0], merged: 2, open: 1, closed: 1 },
        ],
      },
      {
        id: "MDQ6VXNlcjc2NTQzMjE=",
        login: "second-person",
        avatarUrl: "https://avatars.githubusercontent.com/u/7654321?v=4",
        repositories: [
          { repository: targets[0], merged: 1, open: 0, closed: 1 },
        ],
      },
    ],
    issues: {
      firstObservedAt: "2026-10-30T06:00:00.000Z",
      repositories: targets.map((repository, index) => ({
        repository,
        count: index === 0 ? 1 : 0,
      })),
      items: [
        {
          id: "I_kwDOMT5cIs6_8hT6",
          repository: targets[0],
          number: 5518,
          authorId: AUTHOR,
          createdAt: "2026-10-01T18:42:04Z",
          observedAt: "2026-10-30T06:00:30.000Z",
          state: "CLOSED",
          reason: "COMPLETED",
          unavailableSince: null,
          correctedAt: null,
          historyIncompleteSince: null,
          events: [
            {
              id: "CE_lADOMT5cIs6_8hT6zwAAAARU_9RW",
              kind: "closed",
              occurredAt: "2026-10-03T16:26:12Z",
              reason: "COMPLETED",
              relatedIssueId: null,
            },
          ],
        },
      ],
    },
  };
}

test("the directory keeps every person and count and drops the issue history", () => {
  const complete = census();
  assertProfiles(complete);
  const directory = createProfileDirectory(complete);
  expect(directory.format).toBe(PROFILE_DIRECTORY_FORMAT);
  expect(directory.generatedAt).toBe(complete.generatedAt);
  expect(directory.people).toEqual(complete.people);
  expect(directory.repositories).toEqual(complete.repositories);
  expect("issues" in directory).toBe(false);
  const bytes = JSON.stringify(directory);
  expect(bytes).not.toContain("I_kwDOMT5cIs6_8hT6");
  expect(bytes.length).toBeLessThan(JSON.stringify(complete).length);
  // The site reads the published bytes with the census checks.
  const published: unknown = JSON.parse(bytes);
  assertProfileDirectory(published);
  expect(published).toEqual(directory);
});

test("the directory is refused as a retained census", () => {
  const directory = createProfileDirectory(census());
  expect(() => assertRetainedProfiles(directory as never)).toThrow(
    "Invalid profile census",
  );
  expect(() => assertProfiles(directory)).toThrow("Invalid profile census");
});

test("the site refuses a directory that fails the census checks", () => {
  expect(() => assertProfileDirectory(census())).toThrow(
    "Invalid profile directory",
  );
  const short = createProfileDirectory(census());
  short.people[0].repositories[0].merged = 1;
  expect(() => assertProfileDirectory(short)).toThrow(
    "Incomplete profile census",
  );
  const partial = createProfileDirectory(census());
  partial.repositories.shift();
  partial.people = [];
  expect(() => assertProfileDirectory(partial)).toThrow(
    "Profile repository inventory mismatch",
  );
});
