type LoadingStateProps = {
  label?: string;
  size?: 'inline' | 'section' | 'page';
};

export function LoadingState({
  label = 'Loading…',
  size = 'page',
}: LoadingStateProps) {
  return (
    <div className={`loading-state loading-state--${size}`} role="status" aria-live="polite">
      <span className="loading-state__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
