import React, {createContext, useContext, useState, useCallback} from 'react';
import type {ToastPosition} from './ToastManager';

type ToastContextType = {
  showToast: (msg: string, duration?: number, position?: ToastPosition) => void;
  hideToast: () => void;
  toastState: {
    message: string;
    visible: boolean;
    singleLine: boolean;
    duration: number;
    position: ToastPosition;
  };
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [toastState, setToastState] = useState({
    message: '',
    visible: false,
    singleLine: false,
    duration: 1000,
    position: 'bottom' as ToastPosition,
  });
  let timer: NodeJS.Timeout | null = null;

  const showToast = useCallback(
    (msg: string, duration = 1000, position: ToastPosition = 'bottom') => {
      if (timer) clearTimeout(timer);

      const singleLine = msg.length <= 16;
      setToastState({
        message: msg,
        visible: true,
        singleLine,
        duration,
        position,
      });

      if (duration > 0) {
        timer = setTimeout(() => {
          hideToast();
        }, duration);
      }
    },
    [],
  );

  const hideToast = useCallback(() => {
    setToastState(prev => ({...prev, visible: false}));
    if (timer) clearTimeout(timer);
  }, []);

  return (
    <ToastContext.Provider value={{showToast, hideToast, toastState}}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
