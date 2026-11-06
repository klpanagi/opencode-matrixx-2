import type { BuiltinSkill } from "../../../loader/types"
import { buildSection } from "./build"
import { composeSection } from "./compose"
import { deliverySection } from "./delivery"
import { referenceSection } from "./reference"

export const dockerMasterSkill: BuiltinSkill = {
  name: "docker-master",
  description:
    "Use when building Docker images, writing Dockerfiles, debugging containers, or orchestrating services with Docker Compose — Docker expertise covering multi-stage builds, Compose configuration, container debugging, image optimization, and CI/CD pipeline integration. Related: security-infra.",
  template: [buildSection, composeSection, deliverySection, referenceSection].join(""),
}
