// Authenticated file URL — only the logged-in owner can fetch this.
//
// `width` asks the Go service for an on-the-fly thumbnail
// (`GET /api/files/{id}?w=<px>`): it decrypts the blob and downscales it in
// memory, so a grid tile no longer downloads the full 1600 px original. The
// server validates the window (64..800) and ignores the parameter for PDF/GIF,
// but callers should only ask for a width on an image thumbnail. Omit it for
// the lightbox and the "open in new tab" link — those must show the full file.
//
// `unoptimized` on the corresponding <Image> stays: this proxy is the
// optimizer, and Next must not append its own `/_next/image` resizing on top of
// an authenticated, no-store response.
export function fileUrl(
  id: string,
  opts?: { download?: boolean; width?: number },
): string {
  const params = new URLSearchParams();
  if (opts?.width !== undefined) params.set('w', String(opts.width));
  if (opts?.download) params.set('download', '1');
  const query = params.toString();
  return `/api/files/${id}${query ? `?${query}` : ''}`;
}
