/** Return the string only if it looks like a real UUID (v4). Rejects slugs, made-up prefixed IDs, etc. */
export function validUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Standard UUID v4 pattern — also accepts Prisma cuid/cuid2 (25+ alphanum chars)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  // Prisma CUID (starts with c, 25 chars) or CUID2 (24+ chars alphanumeric)
  if (/^c[a-z0-9]{24,}$/i.test(value)) return value;
  return undefined;
}
