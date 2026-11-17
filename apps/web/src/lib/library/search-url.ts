import type { LibrarySearch } from "#lib/shared/library-data.ts";

export function defaultSort(query: string): LibrarySearch["sort"] {
  return query ? "relevance" : "activity";
}

export function libraryUrl(search: LibrarySearch): string {
  const params = new URLSearchParams();
  if (search.query) params.set("q", search.query);
  if (search.language) params.set("language", search.language);
  if (search.status) params.set("status", search.status);
  if (search.added) params.set("added", search.added);
  if (search.sort !== defaultSort(search.query)) {
    params.set("sort", search.sort);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
