import { json } from "./util.js";

// Which sub-route a request is for. Vercel's Hobby plan limits how many API files a deployment may have,
// so related endpoints share one file (api/auth.js, api/billing.js) and the original URLs
// (/api/auth/request etc.) are rewritten to it in vercel.json. We accept either the ?action= value
// from the rewrite or the last path segment, so this works whichever URL the function sees.
export function actionOf(request) {
  const u = new URL(request.url);
  const fromQuery = u.searchParams.get("action");
  if (fromQuery) return fromQuery;
  return u.pathname.split("/").filter(Boolean).pop() || "";
}

// routes: { actionName: handlerFunction }
export function dispatch(routes) {
  return (request) => {
    const handler = Object.hasOwn(routes, actionOf(request)) ? routes[actionOf(request)] : null;
    return handler ? handler(request) : json({ error: "Not found" }, 404);
  };
}
