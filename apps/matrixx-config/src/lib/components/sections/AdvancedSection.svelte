<script lang="ts">
  import { configStore } from "$lib/store/config-store"
  import FieldEditor from "$lib/components/config/FieldEditor.svelte"
  import StringEditor from "$lib/components/config/StringEditor.svelte"
  import BooleanEditor from "$lib/components/config/BooleanEditor.svelte"
  import NumberEditor from "$lib/components/config/NumberEditor.svelte"
  import ArrayEditor from "$lib/components/config/ArrayEditor.svelte"

  let config = $state(configStore.getSnapshot())
  configStore.subscribe((v) => (config = v))

</script>

<div class="section">
  <h2 class="section-title">Advanced</h2>
  <p class="section-desc">Power-user integrations and migration history.</p>

  <h3 class="group">Context Mode</h3>
  <FieldEditor label="Enabled">
    <BooleanEditor value={config.context_mode?.enabled ?? true} onChange={(v) => configStore.updateConfig((c) => ({ ...c, context_mode: { ...c.context_mode, enabled: v } }))} label="Context mode" />
  </FieldEditor>
  <FieldEditor label="Enforce" advanced>
    <BooleanEditor value={config.context_mode?.enforce ?? false} onChange={(v) => configStore.updateConfig((c) => ({ ...c, context_mode: { ...c.context_mode, enforce: v } }))} label="Enforce" />
  </FieldEditor>
  <FieldEditor label="Blocked Tools" advanced>
    <ArrayEditor value={config.context_mode?.blocked_tools ?? []} onChange={(v) => configStore.updateConfig((c) => ({ ...c, context_mode: { ...c.context_mode, blocked_tools: v } }))} label="Blocked" placeholder="tool…" />
  </FieldEditor>

  <h3 class="group">RTK Rewriter</h3>
  <FieldEditor label="Enabled">
    <BooleanEditor value={config.rtk?.enabled ?? false} onChange={(v) => configStore.updateConfig((c) => ({ ...c, rtk: { ...c.rtk, enabled: v } }))} label="RTK" />
  </FieldEditor>
  <FieldEditor label="Binary Path" advanced>
    <StringEditor value={config.rtk?.binary_path ?? ""} onChange={(v) => configStore.updateConfig((c) => ({ ...c, rtk: { ...c.rtk, binary_path: v || undefined } }))} label="Binary" monospace />
  </FieldEditor>
  <FieldEditor label="Timeout (ms)" advanced>
    <NumberEditor value={config.rtk?.timeout_ms ?? 5000} onChange={(v) => configStore.updateConfig((c) => ({ ...c, rtk: { ...c.rtk, timeout_ms: v } }))} label="Timeout" min={1000} max={30000} step={500} />
  </FieldEditor>

  <h3 class="group">Headroom Proxy</h3>
  <FieldEditor label="Enabled">
    <BooleanEditor value={config.headroom?.enabled ?? false} onChange={(v) => configStore.updateConfig((c) => ({ ...c, headroom: { ...c.headroom, enabled: v } }))} label="Headroom" />
  </FieldEditor>
  <FieldEditor label="Proxy URL" advanced>
    <StringEditor value={config.headroom?.proxyUrl ?? ""} onChange={(v) => configStore.updateConfig((c) => ({ ...c, headroom: { ...c.headroom, proxyUrl: v || undefined } }))} label="Proxy URL" placeholder="http://localhost:8080" monospace />
  </FieldEditor>
  <FieldEditor label="Project" advanced>
    <StringEditor value={config.headroom?.project ?? ""} onChange={(v) => configStore.updateConfig((c) => ({ ...c, headroom: { ...c.headroom, project: v || undefined } }))} label="Project" monospace />
  </FieldEditor>
  <FieldEditor label="Backend" advanced>
    <StringEditor value={config.headroom?.backend ?? ""} onChange={(v) => configStore.updateConfig((c) => ({ ...c, headroom: { ...c.headroom, backend: v || undefined } }))} label="Backend" monospace />
  </FieldEditor>

  <h3 class="group">Self Config Skill</h3>
  <FieldEditor label="Enabled">
    <BooleanEditor value={config.matrixx_self_config?.enabled ?? false} onChange={(v) => configStore.updateConfig((c) => ({ ...c, matrixx_self_config: { ...c.matrixx_self_config, enabled: v } }))} label="Self config" />
  </FieldEditor>
  <FieldEditor label="Proactive" advanced>
    <BooleanEditor value={config.matrixx_self_config?.proactive ?? false} onChange={(v) => configStore.updateConfig((c) => ({ ...c, matrixx_self_config: { ...c.matrixx_self_config, proactive: v } }))} label="Proactive" />
  </FieldEditor>

  <h3 class="group">Migrations</h3>
  <FieldEditor label="Applied Migrations" description="Prevents re-applying migrations" advanced>
    <ArrayEditor value={config._migrations ?? []} onChange={(v) => configStore.updateConfig((c) => ({ ...c, _migrations: v.length > 0 ? v : undefined }))} label="Migrations" placeholder="migration-id…" />
  </FieldEditor>
</div>

<style>
  .section { max-width: 48rem; }
  .section-title { font-size: 1.25rem; font-weight: 700; margin: 0 0 0.25rem; }
  .section-desc { font-size: 0.875rem; color: var(--color-text-secondary); margin: 0 0 1rem; }
  .group { font-size: 0.9375rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
</style>
