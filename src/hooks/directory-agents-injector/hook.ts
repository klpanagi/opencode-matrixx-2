import type { MatrixxContext } from "../../plugin/tool/context";
import { createPostReadInjectorHook } from "../post-read-injector/hook";

export function createDirectoryAgentsInjectorHook(ctx: MatrixxContext) {
  return createPostReadInjectorHook(ctx, { trackedTools: ["read"], injectorId: "directory-agents-injector" });
}
