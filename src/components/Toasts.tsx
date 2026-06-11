import type { Toast } from "../types";

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (!toasts.length) {
    return null;
  }
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast ${toast.tone}`} onClick={() => onDismiss(toast.id)}>
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      ))}
    </div>
  );
}
