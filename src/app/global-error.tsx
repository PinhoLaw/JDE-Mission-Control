"use client";

/**
 * global-error.tsx catches errors that occur in the ROOT LAYOUT itself.
 * It must provide its own <html> and <body> tags since the root layout
 * has crashed and cannot render.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#fafafa",
          color: "#111",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 500, padding: 32 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Application Error</h1>
          <p style={{ color: "#666", fontSize: 14, marginBottom: 8 }}>
            {error.message || "An unexpected error occurred."}
          </p>
          {error.digest && (
            <p
              style={{
                color: "#999",
                fontSize: 12,
                fontFamily: "monospace",
                marginBottom: 16,
              }}
            >
              Digest: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              cursor: "pointer",
              border: "1px solid #ddd",
              borderRadius: 6,
              background: "#fff",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
