import { useNavigate } from 'react-router-dom';
import { api } from './api.js';

/** Marks a notification read (if it is not) and follows its link. */
export function useOpenNotification(onRead) {
  const navigate = useNavigate();
  return async (notification) => {
    if (!notification.read) {
      try {
        await api(`/notifications/${notification.id}/read`, { method: 'POST' });
        onRead?.(notification.id);
      } catch {
        // Opening the page matters more than the mark.
      }
    }
    if (notification.link) navigate(notification.link);
  };
}
