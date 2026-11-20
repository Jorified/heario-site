// POST /api/auth/request | /api/auth/verify | /api/auth/logout (see vercel.json rewrites; handlers in lib/handlers).
import { POST as logout } from "../lib/handlers/auth-logout.js";
import { POST as request } from "../lib/handlers/auth-request.js";
import { POST as verify } from "../lib/handlers/auth-verify.js";
import { dispatch } from "../lib/route.js";

export const POST = dispatch({ request, verify, logout });
