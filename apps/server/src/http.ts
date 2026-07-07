export function parseCorsOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function corsOriginFor(allowedOrigins: string[], requestOrigin?: string): string | undefined {
  if (allowedOrigins.includes("*")) return "*";
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  if (!requestOrigin) return allowedOrigins[0];
  return undefined;
}
