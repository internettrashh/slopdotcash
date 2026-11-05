import { expect, test } from "bun:test";
import { collectAcceptedCommitCensus } from "./value-accepted-commit-census";
import type { ValueEvidence } from "./value-evidence";
import type { ValueClient } from "./value-publication";

const start = Date.parse("2026-11-01T00:00:00Z");
const evidence = {
  repository: "owner/repo",
  repositoryNodeId: "R_fixture",
  repositoryDatabaseId: 42,
} as ValueEvidence;
const base = "a".repeat(40);
const head = "b".repeat(40);
const sha = (index: number) => (index + 1).toString(16).padStart(40, "0");

/** PR #2 carries 300 commits. GitHub's commits connection and route list at
 * most 250 of them; the base...head comparison pages the complete range.
 */
async function census(
  options: {
    totalCommits?: number;
    missingObserved?: boolean;
    repeated?: boolean;
  } = {},
) {
  const total = 300;
  const listed = Array.from({ length: total }, (_, index) => sha(index));
  const compared = [...listed];
  if (options.missingObserved) compared[0] = sha(total);
  if (options.repeated) compared[1] = compared[2];
  const page = (offset: number) => ({
    totalCount: total,
    nodes: listed
      .slice(offset, Math.min(offset + 100, 250))
      .map((oid) => ({ commit: { oid } })),
    pageInfo: {
      hasNextPage: offset + 100 < 250,
      endCursor: offset + 100 < 250 ? String(offset + 100) : null,
    },
  });
  const calls: string[] = [];
  const client = {
    async get(path: string) {
      calls.push(path);
      const match = path.match(
        /^\/repos\/owner\/repo\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?per_page=100&page=(\d+)$/u,
      );
      if (!match || match[1] !== base || match[2] !== head) return null;
      const offset = (Number(match[3]) - 1) * 100;
      return {
        total_commits: options.totalCommits ?? total,
        commits: compared.slice(offset, offset + 100).map((sha) => ({ sha })),
      };
    },
    async graphql(query: string, variables: Record<string, unknown>) {
      if (query.includes("commits(first:100,after:")) {
        expect(variables.number).toBe(2);
        return {
          repository: {
            id: "R_fixture",
            pullRequest: {
              id: "PR_2",
              commits: page(Number(variables.after)),
            },
          },
        };
      }
      return {
        search: {
          issueCount: 2,
          nodes: [1, 2].map((number) => ({
            id: `PR_${number}`,
            number,
            url: `https://github.com/owner/repo/pull/${number}`,
            mergedAt: new Date(start + number * 1000).toISOString(),
            repository: {
              id: "R_fixture",
              databaseId: 42,
              nameWithOwner: "owner/repo",
              isPrivate: false,
            },
            mergeCommit: { oid: sha(1000 + number) },
            baseRefOid: base,
            headRefOid: number === 2 ? head : "c".repeat(40),
            commits:
              number === 2
                ? page(0)
                : {
                    totalCount: 1,
                    nodes: [{ commit: { oid: sha(500) } }],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
          })),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    },
  } as unknown as ValueClient;
  return {
    result: await collectAcceptedCommitCensus(client, evidence, start),
    calls,
  };
}

test("a census completes a pull request above the 250-commit listing through the comparison", async () => {
  const { result, calls } = await census();
  expect(result?.ids.size).toBe(2);
  // Every commit of PR #2 carries it, including the 50 the connection omitted,
  // and the merge commit.
  expect(result?.carriers.get(sha(0))?.map((c) => c.number)).toEqual([2]);
  expect(result?.carriers.get(sha(299))?.map((c) => c.number)).toEqual([2]);
  expect(result?.carriers.get(sha(1002))?.map((c) => c.number)).toEqual([2]);
  expect(result?.carriers.size).toBe(300 + 1 + 2);
  expect(calls).toHaveLength(3);
});

test("a comparison that reports a different commit count keeps the census pending", async () => {
  expect((await census({ totalCommits: 301 })).result).toBeNull();
});

test("a comparison that omits an observed commit keeps the census pending", async () => {
  expect((await census({ missingObserved: true })).result).toBeNull();
});

test("a comparison that repeats a commit keeps the census pending", async () => {
  expect((await census({ repeated: true })).result).toBeNull();
});
