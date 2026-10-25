import { describe, expect, test } from "bun:test"
import { parseModelRef } from "../../../src/agents/agent-config"
import {
  buildMousePrompt,
  createMouseAgentWithOverrides,
  getMousePromptSource,
  MOUSE_DEFAULTS,
} from "../../../src/agents/mouse/index"
import {
  buildConstraintsSection,
  buildTodoDisciplineSection,
  buildVerificationTable,
} from "../../../src/agents/mouse/shared"

type AgentConfigWithModelConfig = {
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
  reasoningEffort?: "low" | "medium" | "high" | "xhigh"
}

describe("createMouseAgentWithOverrides", () => {
  describe("honored fields", () => {
    test("applies model override", () => {
      // given
      const override = { model: "openai/gpt-5.2" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.model).toEqual(parseModelRef("openai/gpt-5.2"))
    })

    test("applies temperature override", () => {
      // given
      const override = { request: { body: { temperature: 0.5 } } }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.request?.body?.temperature).toBe(0.5)
    })

    test("applies top_p override", () => {
      // given
      const override = { request: { body: { top_p: 0.9 } } }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.request?.body?.top_p).toBe(0.9)
    })

    test("applies description override", () => {
      // given
      const override = { description: "Custom description" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.description).toBe("Custom description")
    })

    test("applies color override", () => {
      // given
      const override = { color: "#FF0000" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.color).toBe("#FF0000")
    })

    test("appends prompt_append to base prompt", () => {
      // given
      const override = { system_append: "Extra instructions here" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.system).toContain("You work ALONE")
      expect(result.system).toContain("Extra instructions here")
    })
  })

  describe("defaults", () => {
    test("uses default model when no override", () => {
      // given
      const override = {}

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.model).toEqual(parseModelRef(MOUSE_DEFAULTS.model))
    })

    test("uses default temperature when no override", () => {
      // given
      const override = {}

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.request?.body?.temperature).toBe(MOUSE_DEFAULTS.temperature)
    })
  })

  describe("disable semantics", () => {
    test("disable: true causes override block to be ignored", () => {
      // given
      const override = {
        disabled: true,
        model: "openai/gpt-5.2",
        request: { body: { temperature: 0.9 } },
      }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then - defaults should be used, not the overrides
      expect(result.model).toEqual(parseModelRef(MOUSE_DEFAULTS.model))
      expect(result.request?.body?.temperature).toBe(MOUSE_DEFAULTS.temperature)
    })
  })

  describe("constrained fields", () => {
    test("mode is forced to subagent", () => {
      // given
      const override = { mode: "primary" as const }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.mode).toBe("subagent")
    })

    test("prompt override is ignored (discipline text preserved)", () => {
      // given
      const override = { system: "Completely new prompt that replaces everything" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.system).toContain("You work ALONE")
      expect(result.system).not.toBe("Completely new prompt that replaces everything")
    })
  })

  describe("tool safety (subagent blocked, pure leaf)", () => {
    // NOTE (V2): delegation gating is a permissions ruleset. Mouse is a pure
    // leaf: the factory always denies subagent. task-store access is granted
    // later by the tool-config handler (fullTaskPermissions), not here.
    test("subagent stays denied even when the override asks for task tools", () => {
      // given
      const override = {
        permissions: [
          { action: "task", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
        ],
      }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      const rules = result.permissions ?? []
      expect(rules.some((r) => r.action === "subagent" && r.effect === "deny")).toBe(true)
      expect(rules.some((r) => r.action === "task" && r.effect === "allow")).toBe(true)
    })

    test("subagent stays denied with no override", () => {
      // when
      const result = createMouseAgentWithOverrides({})

      // then - pure leaf with no delegation of its own
      const rules = result.permissions ?? []
      expect(rules.some((r) => r.action === "subagent" && r.effect === "deny")).toBe(true)
    })
  })

  describe("task system integration", () => {
    test("produces Task_Discipline prompt for Claude", () => {
      //#given
      const override = { model: "anthropic/claude-sonnet-4-5" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect(result.system).toContain("task_create")
      expect(result.system).toContain("task_update")
      expect(result.system).not.toContain("todowrite")
    })

    test("produces task_discipline_spec prompt for GPT", () => {
      //#given
      const override = { model: "openai/gpt-5.2" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect(result.system).toContain("<task_discipline_spec>")
      expect(result.system).toContain("task_create")
      expect(result.system).not.toContain("<todo_discipline_spec>")
    })

    
    test("explicitly lists task management tools as ALLOWED for Claude", () => {
      //#given
      const override = { model: "anthropic/claude-sonnet-4-5" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then - prompt must disambiguate: delegation tool blocked, management tools allowed
      expect(result.system).toContain("task_create")
      expect(result.system).toContain("task_update")
      expect(result.system).toContain("task_list")
      expect(result.system).toContain("task_get")
      expect(result.system).toContain("agent delegation tool")
    })

    test("explicitly lists task management tools as ALLOWED for GPT", () => {
      //#given
      const override = { model: "openai/gpt-5.2" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then - prompt must disambiguate: delegation tool blocked, management tools allowed
      expect(result.system).toContain("task_create")
      expect(result.system).toContain("task_update")
      expect(result.system).toContain("task_list")
      expect(result.system).toContain("task_get")
      expect(result.system).toContain("Agent delegation tool")
    })

      })

  // C7 fence: the file-backed task system is unconditional and the legacy todo
  // tools are denied for mouse, so NO mouse prompt variant may name them.
  const LEGACY_TODO_TOOL = /todowrite|todoread|TodoWrite/i
  const VARIANT_MODELS = [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-5.2",
    "opencode-go/deepseek-v4-flash",
    "opencode-go/mimo-v2.5",
    "opencode-go/qwen3.7-plus",
  ]

  test.each(VARIANT_MODELS)("%s prompt names no legacy todo tool", (model) => {
    //#given a mouse model variant

    //#when
    const prompt = buildMousePrompt(model)

    //#then
    expect(prompt).not.toContain("todowrite")
    expect(prompt).not.toContain("todoread")
    expect(prompt).not.toMatch(LEGACY_TODO_TOOL)
  })

  test("every shared prompt utility section names no legacy todo tool", () => {
    //#given the shared section builders

    //#when
    const sections = [
      buildConstraintsSection(),
      buildTodoDisciplineSection(),
      buildVerificationTable(),
    ]

    //#then
    for (const section of sections) {
      expect(section).not.toMatch(LEGACY_TODO_TOOL)
    }
  })

  describe("prompt composition", () => {
    test("base prompt contains discipline constraints", () => {
      // given
      const override = {}

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.system).toContain("Mouse")
      expect(result.system).toContain("You work ALONE")
    })

    test("Claude model uses default prompt with BLOCKED ACTIONS section", () => {
      // given
      const override = { model: "anthropic/claude-sonnet-4-5" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.system).toContain("BLOCKED ACTIONS")
      expect(result.system).not.toContain("<blocked_actions>")
    })

    test("GPT model uses GPT-optimized prompt with blocked_actions section", () => {
      // given
      const override = { model: "openai/gpt-5.2" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      expect(result.system).toContain("<blocked_actions>")
      expect(result.system).toContain("<output_verbosity_spec>")
      expect(result.system).toContain("<scope_and_design_constraints>")
    })

    test("prompt_append is added after base prompt", () => {
      // given
      const override = { system_append: "CUSTOM_MARKER_FOR_TEST" }

      // when
      const result = createMouseAgentWithOverrides(override)

      // then
      const baseEndIndex = result.system?.indexOf("Dense > verbose.")
      const appendIndex = result.system?.indexOf("CUSTOM_MARKER_FOR_TEST")
      expect(baseEndIndex).not.toBe(-1)
      expect(appendIndex).toBeGreaterThan(baseEndIndex)
    })
  })

  describe("model-specific thinking/reasoning config", () => {
    test("Claude model gets thinking config", () => {
      //#given
      const override = { model: "anthropic/claude-sonnet-4-5" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
      expect((result.request?.body as AgentConfigWithModelConfig).reasoningEffort).toBeUndefined()
    })

    test("Google Vertex Anthropic model gets thinking config", () => {
      //#given
      const override = { model: "google-vertex-anthropic/claude-opus-4-6@default" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    })

    test("GPT model gets reasoningEffort config", () => {
      //#given
      const override = { model: "openai/gpt-5.2" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).reasoningEffort).toBe("medium")
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toBeUndefined()
    })

    test("Gemini model gets NO thinking or reasoning config", () => {
      //#given
      const override = { model: "google-vertex/gemini-flash-latest" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toBeUndefined()
      expect((result.request?.body as AgentConfigWithModelConfig).reasoningEffort).toBeUndefined()
    })

    test("Google Gemini Pro model gets NO thinking config", () => {
      //#given
      const override = { model: "google/gemini-3-pro" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toBeUndefined()
      expect((result.request?.body as AgentConfigWithModelConfig).reasoningEffort).toBeUndefined()
    })

    test("unknown provider model gets NO thinking config", () => {
      //#given
      const override = { model: "custom-provider/custom-model" }

      //#when
      const result = createMouseAgentWithOverrides(override)

      //#then
      expect((result.request?.body as AgentConfigWithModelConfig).thinking).toBeUndefined()
      expect((result.request?.body as AgentConfigWithModelConfig).reasoningEffort).toBeUndefined()
    })
  })
})

describe("getMousePromptSource", () => {
  test("returns 'gpt' for OpenAI models", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const source = getMousePromptSource(model)

    // then
    expect(source).toBe("gpt")
  })

  test("returns 'gpt' for GitHub Copilot GPT models", () => {
    // given
    const model = "github-copilot/gpt-4o"

    // when
    const source = getMousePromptSource(model)

    // then
    expect(source).toBe("gpt")
  })

  test("returns 'default' for Claude models", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5"

    // when
    const source = getMousePromptSource(model)

    // then
    expect(source).toBe("default")
  })

  test("returns 'default' for undefined model", () => {
    // given
    const model = undefined

    // when
    const source = getMousePromptSource(model)

    // then
    expect(source).toBe("default")
  })
})

describe("buildMousePrompt", () => {
  test("GPT model prompt contains GPT-5.2 specific sections", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const prompt = buildMousePrompt(model)

    // then
    expect(prompt).toContain("<identity>")
    expect(prompt).toContain("<output_verbosity_spec>")
    expect(prompt).toContain("<scope_and_design_constraints>")
    expect(prompt).toContain("<tool_usage_rules>")
  })

  test("Claude model prompt contains Claude-specific sections", () => {
    // given
    const model = "anthropic/claude-sonnet-4-5"

    // when
    const prompt = buildMousePrompt(model)

    // then
    expect(prompt).toContain("<Role>")
    expect(prompt).toContain("<Critical_Constraints>")
    expect(prompt).toContain("BLOCKED ACTIONS")
  })

  test("includes Task_Discipline for GPT", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const prompt = buildMousePrompt(model)

    // then
    expect(prompt).toContain("<task_discipline_spec>")
    expect(prompt).toContain("task_create")
  })

  })

describe("getMousePromptSource (new variants)", () => {
  test("returns 'deepseek' for DeepSeek models", () => {
    expect(getMousePromptSource("opencode-go/deepseek-v4-flash")).toBe("deepseek");
  });

  test("returns 'mimo' for Mimo models", () => {
    expect(getMousePromptSource("opencode-go/mimo-v2.5")).toBe("mimo");
  });

  test("returns 'qwen' for Qwen models", () => {
    expect(getMousePromptSource("opencode-go/qwen3.7-plus")).toBe("qwen");
  });

  test("GPT takes priority over DeepSeek when model matches GPT prefixes", () => {
    expect(getMousePromptSource("opencode-go/gpt-5.2")).toBe("gpt");
  });
});

describe("buildMousePrompt (new variants)", () => {
  test("DeepSeek model prompt contains DeepSeek-specific sections", () => {
    //#given
    const model = "opencode-go/deepseek-v4-flash";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("<Role>");
    expect(prompt).toContain("<Critical_Constraints>");
    expect(prompt).toContain("<Verification>");
    expect(prompt).toContain("<Style>");
    expect(prompt).not.toContain("you're too helpful");
  });

  test("Mimo model prompt contains Mimo-specific sections", () => {
    //#given
    const model = "opencode-go/mimo-v2.5";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<rules>");
    expect(prompt).toContain("<verify>");
    expect(prompt).toContain("<discipline>");
    // Mimo uses lowercase tags (model-specific)
    expect(prompt).not.toContain("<Role>");
  });

  test("Qwen model prompt contains Qwen-specific sections", () => {
    //#given
    const model = "opencode-go/qwen3.7-plus";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("<identity>");
    expect(prompt).toContain("<blocked_actions>");
    expect(prompt).toContain("<scope_control>");
    expect(prompt).toContain("<task_discipline>");
    expect(prompt).toContain("<verification>");
    expect(prompt).toContain("<style>");
  });

  test("DeepSeek prompt uses Task_Discipline", () => {
    //#given
    const model = "opencode-go/deepseek-v4-flash";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("<Task_Discipline>");
    expect(prompt).toContain("<Critical_Constraints>");
    expect(prompt).toContain("<Verification>");
    expect(prompt).toContain("task_create");
  });

  test("Mimo prompt uses Task reference", () => {
    //#given
    const model = "opencode-go/mimo-v2.5";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("task_create");
    expect(prompt).toContain("task_update");
  });

  
  test("Qwen prompt uses task_discipline", () => {
    //#given
    const model = "opencode-go/qwen3.7-plus";

    //#when
    const prompt = buildMousePrompt(model);

    //#then
    expect(prompt).toContain("<task_discipline>");
    expect(prompt).toContain("task_create");
    expect(prompt).toContain("task_create");
  });

  });

describe("createMouseAgentWithOverrides (DeepSeek thinking)", () => {
  test("DeepSeek model gets thinking config (like Anthropic)", () => {
    //#given
    const override = { model: "opencode-go/deepseek-v4-flash" };

    //#when
    const result = createMouseAgentWithOverrides(override);

    //#then
    expect((result.request?.body as AgentConfigWithModelConfig).thinking).toEqual({ type: "enabled", budgetTokens: 32000 });
  });
});

describe("shared prompt utilities", () => {
  test("buildConstraintsSection blocks task delegation", () => {
    const constraints = buildConstraintsSection();
    expect(constraints).toContain("BLOCKED");
    expect(constraints).toContain("task");
    expect(constraints).toContain("You work ALONE");
  });

  test("buildConstraintsSection includes task management tools", () => {
    const constraints = buildConstraintsSection();
    expect(constraints).toContain("task_create");
    expect(constraints).toContain("task_update");
  });

  test("buildTodoDisciplineSection uses Task_Discipline", () => {
    const section = buildTodoDisciplineSection();
    expect(section).toContain("<Task_Discipline>");
    expect(section).toContain("task_create");
    expect(section).not.toContain("todowrite");
  });

  
  test("buildVerificationTable returns table with lsp_diagnostics check", () => {
    const table = buildVerificationTable();
    expect(table).toContain("lsp_diagnostics");
    expect(table).toContain("Zero errors");
    expect(table).toContain("No evidence = not complete.");
  });

  test("buildVerificationTable references task_update", () => {
    const table = buildVerificationTable();
    expect(table).toContain("task_update");
    expect(table).toContain("All tasks marked completed");
  });

  });
