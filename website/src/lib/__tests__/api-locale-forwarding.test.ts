import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every server route that talks to Go has to tell Go which language to answer in.
//
// `?lang=` is the first level of Go's precedence chain. `lib/api/client.ts` adds
// it to every call, but the routes under `src/app/api/` proxy raw bodies and byte
// streams and therefore bypass that client — and two of them shipped without it.
// The import route rendered a backup-provenance warning in the account's language
// while the page was in another, and the export route wrote a language-dependent
// note inside the downloaded archive.
//
// This is a source scan rather than a behavioural test, and that is deliberate: a
// behavioural test would have to stand up Go, a session and a route handler to see
// one query string. What it can do is make the omission impossible to reintroduce.

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('server routes forward the page locale to Go', () => {
  const dir = join(process.cwd(), 'src/app/api');

  it('every route that calls GO_API_URL includes lang=', () => {
    const offenders: string[] = [];

    for (const file of routeFiles(dir)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('GO_API_URL')) continue;
      // Only the URL construction matters; a route could also forward the raw
      // client query string, in which case `lang` may arrive from the caller.
      const buildsUpstreamUrl = /GO_API_URL\}`?/.test(source);
      if (!buildsUpstreamUrl) continue;
      if (!/lang=\$\{/.test(source)) offenders.push(file.replace(process.cwd() + '/', ''));
    }

    expect(offenders, `these routes build a Go URL without ?lang=: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the scan sees the routes it is meant to guard', () => {
    // A guard that silently matches nothing is worse than no guard.
    const withGo = routeFiles(dir).filter((f) => readFileSync(f, 'utf8').includes('GO_API_URL'));
    expect(withGo.length).toBeGreaterThanOrEqual(4);
  });
});
