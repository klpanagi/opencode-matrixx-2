import type { MatrixxContext } from "../../plugin/context";
import { createPostReadInjectorHook } from "../post-read-injector/hook";

export function createRulesInjectorHook(ctx: MatrixxContext) {
  return createPostReadInjectorHook(ctx, { trackedTools: ["read", "write", "edit", "multiedit"] });
}
