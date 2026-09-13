import type { AlertButton, AlertOptions } from 'react-native';

// Settings use a notice or a single confirmation plus Cancel.
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], _options?: AlertOptions) {
    const text = [title, message].filter(Boolean).join('\n\n');
    if (!buttons || buttons.length <= 1) {
      window.alert(text);
      buttons?.[0]?.onPress?.();
      return;
    }
    const action = buttons.find(button => button.style !== 'cancel');
    const cancel = buttons.find(button => button.style === 'cancel');
    if (window.confirm(text)) action?.onPress?.();
    else cancel?.onPress?.();
  },
};
