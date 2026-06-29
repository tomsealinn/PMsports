interface ToastProps {
  message: string;
}

export function Toast({ message }: ToastProps) {
  return <div className={`toast ${message ? 'show' : ''}`}>{message}</div>;
}
