package demo;

// Entry point for the demo service.
public final class Sample {
    /* Retry budget shared by all clients. */
    private static final int RETRIES = 3;

    /**
     * Builds the default client.
     */
    public static void main(String[] args) {
        int attempts = RETRIES; // bounded by the constant above
        System.out.println(attempts);
    }
}
