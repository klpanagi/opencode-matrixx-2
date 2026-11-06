import type { BuiltinSkill } from "../../../loader/types"
import { commitSection } from "./commit"
import { executionSection } from "./execution"
import { historySection } from "./history"
import { rebaseSection } from "./rebase"

export const gitMasterSkill: BuiltinSkill = {
  name: "git-master",
  description:
    "Use when creating commits, rebasing branches, searching git history, or managing version control workflows — Git expertise covering atomic commits, rebase/squash, history search (blame, bisect, log -S), and style-aware commit messages.",
  template: [commitSection, executionSection, rebaseSection, historySection].join(""),
}
