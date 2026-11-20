// POST /api/billing/checkout | /api/billing/portal (see vercel.json rewrites; handlers in lib/handlers).
import { POST as checkout } from "../lib/handlers/billing-checkout.js";
import { POST as portal } from "../lib/handlers/billing-portal.js";
import { dispatch } from "../lib/route.js";

export const POST = dispatch({ checkout, portal });
