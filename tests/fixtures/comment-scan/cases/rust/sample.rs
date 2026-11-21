//! Internal helpers for pagination.

// Upper bound used by the paginator.
pub fn page_size() -> usize {
    50
}

/// Documented accessor for the page size.
pub fn current() -> usize {
    page_size() // value is constant for now
}
