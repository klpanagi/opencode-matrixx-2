const {
  describe: bunDescribe,
  test: bunTest,
  expect: bunExpect,
} = require("bun:test");

bunDescribe("hookOutputText (tool.execute.after adapter)", () => {
  bunTest("passes string content through", async () => {
    //#given the host-normalized shape and the legacy string shape
    const { hookOutputText } = require("../../src/plugin/setup-domains");

    //#when extracting
    //#then both yield the text
    bunExpect(hookOutputText("hello")).toBe("hello");
    bunExpect(hookOutputText([{ type: "text", text: "OBS-OK" }])).toBe("OBS-OK");
  });

  bunTest("joins text parts and skips non-text parts", async () => {
    //#given mixed content parts
    const { hookOutputText } = require("../../src/plugin/setup-domains");

    //#when extracting
    const out = hookOutputText([
      { type: "text", text: "first" },
      { type: "image", uri: "x" },
      "raw",
      { type: "text", text: "" },
      { type: "text", text: "second" },
    ]);

    //#then only text lands, joined
    bunExpect(out).toBe("first\nraw\n\nsecond");
  });

  bunTest("returns undefined when no text is present", async () => {
    //#given content without text
    const { hookOutputText } = require("../../src/plugin/setup-domains");

    //#when extracting
    //#then the hook layer stays empty and downstream guards apply
    bunExpect(hookOutputText(undefined)).toBeUndefined();
    bunExpect(hookOutputText([])).toBeUndefined();
    bunExpect(hookOutputText([{ type: "image", uri: "x" }])).toBeUndefined();
  });
});
