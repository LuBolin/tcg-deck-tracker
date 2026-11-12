import { useEffect } from 'react';
import { APP_NAME } from '../app/repo';

/** Browser tab title for the current page. */
export function useTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
