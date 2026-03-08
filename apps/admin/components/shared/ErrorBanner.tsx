/**
 * Simple conditional error banner using the hf-banner design system.
 *
 * Renders nothing when `error` is null/undefined/empty.
 *
 * @example
 * ```tsx
 * const [error, setError] = useState<string | null>(null);
 * <ErrorBanner error={error} />
 * <ErrorBanner error={error} onRetry={() => refetch()} />
 * ```
 */
export function ErrorBanner({
  error,
  className,
  style,
  onRetry,
  onDismiss,
}: {
  error: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  /** Show an inline Retry button */
  onRetry?: () => void;
  /** Show an inline Dismiss (X) button */
  onDismiss?: () => void;
}) {
  if (!error) return null;
  return (
    <div
      className={`hf-banner hf-banner-error${className ? ` ${className}` : ""}`}
      style={style}
    >
      <span>{error}</span>
      {(onRetry || onDismiss) && (
        <span className="hf-banner-actions">
          {onRetry && (
            <button className="hf-btn hf-btn-sm hf-btn-secondary" onClick={onRetry}>
              Retry
            </button>
          )}
          {onDismiss && (
            <button className="hf-btn hf-btn-sm hf-btn-ghost" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </span>
      )}
    </div>
  );
}
