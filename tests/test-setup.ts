import { beforeEach } from "bun:test"
import { _resetForTesting } from "../src/features/session-state/state"
import { _resetAssemblyStateForTesting } from "../src/features/assembly-state/manager"
import { _resetPruneThrottleForTesting } from "../src/features/background-agent/manager"
import { _resetMessageDirCacheForTesting } from "../src/features/background-agent/message-dir"
import { _resetTaskToastManagerForTesting } from "../src/features/task-toast-manager/manager"
import { _resetRedpillStateForTesting } from "../src/features/redpill-state/manager"
import { _resetRuleCacheForTesting } from "../src/hooks/rules-injector/injector"
import { _resetThinkModeStateForTesting } from "../src/hooks/think-mode/hook"
import { _resetNormalizeModelCacheForTesting } from "../src/hooks/think-mode/switcher"
import { _resetDisabledSetsCacheForTesting } from "../src/plugin-config"
import { _resetDisciplineCacheForTesting } from "../src/agents/shared/dynamic-agent-prompt-builder"
import { _resetContextModeEnforcementForTesting } from "../src/shared/policy/context-mode-enforcement"
import { _resetDcpGuidanceForTesting } from "../src/shared/policy/dcp-guidance"
import { _resetSdkMessageCache } from "../src/features/context-injection/hook-bridge"

beforeEach(() => {
  _resetForTesting()
  _resetSdkMessageCache()
  _resetAssemblyStateForTesting()
  _resetPruneThrottleForTesting()
  _resetMessageDirCacheForTesting()
  _resetTaskToastManagerForTesting()
  _resetRedpillStateForTesting()
  _resetRuleCacheForTesting()
  _resetThinkModeStateForTesting()
  _resetNormalizeModelCacheForTesting()
  _resetDisabledSetsCacheForTesting()
  _resetDisciplineCacheForTesting()
  _resetContextModeEnforcementForTesting()
  _resetDcpGuidanceForTesting()
})
