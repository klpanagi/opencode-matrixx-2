package demo

// Small registry of feature flags.
object Flags {
    /* Enabled by default for local runs. */
    val local = true

    fun describe(): String {
        return "local=$local" // shown in the startup banner
    }
}
