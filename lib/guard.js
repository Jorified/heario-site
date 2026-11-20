import { currentAccount } from "./auth.js";
import { isSameOrigin, json } from "./util.js";

// Use at the top of every dashboard endpoint:
//   const g = await guard(request, { mutating: true }); if (g.response) return g.response;
export async function guard(request, { mutating = false } = {}) {
  if (mutating && !isSameOrigin(request)) return { response: json({ error: "Bad origin" }, 403) };
  const account = await currentAccount(request);
  if (!account) return { response: json({ error: "Please log in." }, 401) };
  return { account };
}
