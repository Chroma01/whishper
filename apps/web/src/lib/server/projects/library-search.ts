import { sql, type SQL } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import type { TranscriptHit } from "#lib/shared/library-data.ts";
import {
  ftsMatchExpression,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  highlightQuery,
  needsSubstringSearch,
  segmentsFromMarkers,
  type SearchQuery,
} from "#lib/shared/search-query.ts";
import { normalizeSearchText } from "#lib/shared/search.ts";

// Enough to scan a project's matches in the library. The studio's find bar
// shows the rest.
export const HITS_PER_PROJECT = 20;

export type TranscriptMatches = {
  hitCount: number;
  // Lower is better, as FTS5's bm25() ranks. Zero without the index.
  bestScore: number;
  languages: Map<string, number>;
  hits: TranscriptHit[];
};

type CountRow = {
  projectId: string;
  language: string;
  count: number;
  bestScore: number;
};

type HitRow = {
  projectId: string;
  trackId: string;
  cueId: string;
  language: string;
  startUs: number;
  text: string;
};

// Each matching cue joined to its track and project, filtered to one
// workspace and optionally one language.
function matchingCues(
  query: SearchQuery,
  workspaceId: string,
  language: string | null,
): { from: SQL; score: SQL; text: SQL } | null {
  const scope = sql`p.workspace_id = ${workspaceId}${
    language === null ? sql`` : sql` and t.language = ${language}`
  }`;
  if (needsSubstringSearch(query)) {
    const has = (text: string) =>
      sql`instr(search_text(c.text), ${normalizeSearchText(text)}) > 0`;
    const conditions = [
      ...query.terms.map((term) => has(term.text)),
      ...query.excluded.map((term) => sql`not ${has(term.text)}`),
    ];
    return {
      from: sql`cues c
        join subtitle_tracks t on t.id = c.track_id
        join projects p on p.id = t.project_id
        where ${scope} and ${sql.join(conditions, sql` and `)}`,
      score: sql`0`,
      text: sql`c.text`,
    };
  }
  const expression = ftsMatchExpression(query);
  if (expression === null) return null;
  return {
    // CROSS JOIN keeps the match as the outer loop. Otherwise SQLite may
    // run the whole match again for every row of the inner tables.
    from: sql`cue_search
      cross join cue_search_rows r on r.rowid = cue_search.rowid
      cross join cues c on c.id = r.cue_id
      cross join subtitle_tracks t on t.id = c.track_id
      cross join projects p on p.id = t.project_id
      where cue_search match ${expression} and ${scope}`,
    score: sql`bm25(cue_search)`,
    text: sql`highlight(cue_search, 0, ${HIGHLIGHT_START}, ${HIGHLIGHT_END})`,
  };
}

export function searchTranscripts(
  executor: Executor,
  workspaceId: string,
  query: SearchQuery,
  language: string | null,
): Map<string, TranscriptMatches> {
  const matching = matchingCues(query, workspaceId, language);
  const matches = new Map<string, TranscriptMatches>();
  if (matching === null) return matches;

  // bm25() cannot run inside an aggregate, so the scores are materialized
  // first. A line repeated at the same second by another transcript of the
  // project counts once.
  const counts = executor.all<CountRow>(sql`
    with scored as materialized (
      select p.id as projectId, t.language as language,
             c.text || char(31) || (c.start_us / 1000000) as line,
             ${matching.score} as score
      from ${matching.from}
    )
    select projectId, language, count(distinct line) as count,
           min(score) as bestScore
    from scored
    group by projectId, language`);
  for (const row of counts) {
    const match = matches.get(row.projectId) ?? {
      hitCount: 0,
      bestScore: 0,
      languages: new Map(),
      hits: [],
    };
    match.hitCount += row.count;
    match.bestScore = Math.min(match.bestScore, row.bestScore);
    match.languages.set(row.language, row.count);
    matches.set(row.projectId, match);
  }
  if (matches.size === 0) return matches;

  // highlight() only works in the query that runs the match, so the first
  // hits of each project are chosen by cue id in a subquery. A line repeated
  // at the same second by another transcript in the same language is kept
  // once, as the counts do.
  const hits = executor.all<HitRow>(sql`
    select p.id as projectId, t.id as trackId, c.id as cueId,
           t.language as language, c.start_us as startUs,
           ${matching.text} as text
    from ${matching.from}
      and c.id in (
        select cueId from (
          select cueId,
                 row_number() over (
                   partition by projectId order by startUs, language
                 ) as position
          from (
            select c.id as cueId, p.id as projectId, t.language as language,
                   c.start_us as startUs,
                   row_number() over (
                     partition by p.id, t.language, c.text,
                                  c.start_us / 1000000
                     order by c.start_us, c.id
                   ) as copy
            from ${matching.from}
          )
          where copy = 1
        )
        where position <= ${HITS_PER_PROJECT}
      )
    order by p.id, c.start_us, t.language`);
  const marked = !needsSubstringSearch(query);
  for (const row of hits) {
    matches.get(row.projectId)?.hits.push({
      cueId: row.cueId,
      trackId: row.trackId,
      language: row.language,
      startUs: row.startUs,
      segments: marked
        ? segmentsFromMarkers(row.text)
        : highlightQuery(row.text, query),
    });
  }
  return matches;
}

export function workspaceLanguages(
  executor: Executor,
  workspaceId: string,
): string[] {
  return executor
    .all<{ language: string }>(
      sql`
      select distinct t.language as language
      from subtitle_tracks t
      join projects p on p.id = t.project_id
      where p.workspace_id = ${workspaceId}
      order by t.language`,
    )
    .map((row) => row.language);
}

export function projectLanguages(
  executor: Executor,
  workspaceId: string,
): Map<string, string[]> {
  const rows = executor.all<{ projectId: string; language: string }>(sql`
    select t.project_id as projectId, t.language as language
    from subtitle_tracks t
    join projects p on p.id = t.project_id
    where p.workspace_id = ${workspaceId}
    group by t.project_id, t.language
    order by min(t.created_at)`);
  const languages = new Map<string, string[]>();
  for (const { projectId, language } of rows) {
    const list = languages.get(projectId) ?? [];
    list.push(language);
    languages.set(projectId, list);
  }
  return languages;
}
