import { useUiStore } from "../../store/ui";

export function ToastRegion() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismiss);

  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => (
        <button
          className={`toast toast-${toast.tone}`}
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          type="button"
        >
          <span className="toast-mark" />
          {toast.message}
        </button>
      ))}
    </div>
  );
}
