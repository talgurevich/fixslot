import { RequestHandler } from "express";

declare module "express-session" {
  interface SessionData {
    authed?: boolean;
  }
}

// Page requests redirect to the login form when unauthenticated.
export const requireAuthPage: RequestHandler = (req, res, next) => {
  if (req.session.authed) return next();
  res.redirect("/login");
};

// API requests get a 401 JSON response when unauthenticated.
export const requireAuthApi: RequestHandler = (req, res, next) => {
  if (req.session.authed) return next();
  res.status(401).json({ error: "unauthorized" });
};
