import express from "express";
import { registerCollectionRoutes } from "./collections.js";
import { registerCommentRoutes } from "./comments.js";
import { registerDrawingRoutes } from "./drawings.js";
import { registerLibraryRoutes } from "./library.js";
import { DashboardRouteDeps } from "./types.js";

export const registerDashboardRoutes = (
  app: express.Express,
  deps: DashboardRouteDeps
) => {
  registerDrawingRoutes(app, deps);
  registerCollectionRoutes(app, deps);
  registerLibraryRoutes(app, deps);
  registerCommentRoutes(app, deps);
};

export type { DashboardRouteDeps } from "./types.js";
