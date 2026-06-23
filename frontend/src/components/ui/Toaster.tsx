import React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

/**
 * Wrapper do Toaster do sonner com defaults do portal.
 * Use `toast.success()`, `toast.error()`, `toast.info()` em qualquer lugar.
 */
export const Toaster: React.FC = () => (
  <SonnerToaster
    position="top-right"
    richColors
    closeButton
    duration={4000}
    toastOptions={{
      style: {
        fontFamily: 'Inter, system-ui, sans-serif',
      },
    }}
  />
);

export { toast };
export default Toaster;
