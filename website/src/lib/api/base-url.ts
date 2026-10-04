// Base URL of the Go service, including its `/api` prefix.
//
// Its own module so the two callers that must not import each other can share
// it: `client.ts` (the typed client) and `lib/auth.ts` (which resolves the user
// without going through the typed client — see the note there).

export const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
