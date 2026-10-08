/**
 * Tiny fetch wrapper for the planner's client components: JSON in, JSON out,
 * and a thrown Error carrying the API's human message on failure.
 */
export async function plannerApi<T = Record<string, unknown>>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; issues?: { message: string }[] };
  if (!res.ok) {
    const msg =
      data.message ??
      data.issues?.[0]?.message ??
      (data.error === "forbidden" ? "You don't have permission to do that." : data.error) ??
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
