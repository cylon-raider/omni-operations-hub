import { useCallback, useState } from 'react';
import Toast from '../components/Toast';

export function useToast() {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  const ToastContainer = toast ? (
    <Toast
      key={toast.key}
      message={toast.message}
      type={toast.type}
      onClose={() => setToast(null)}
    />
  ) : null;

  return { showToast, ToastContainer };
}
