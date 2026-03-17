import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export type HeaderRefreshHandler = () => void | Promise<void>;

const headerRefreshHandlers = new Map<string, HeaderRefreshHandler>();

const normalizeRefreshKey = (pathname: string): string => {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return trimmed === '/dashboard' ? '/' : trimmed;
};

const resolveHeaderRefreshHandler = (pathname: string): HeaderRefreshHandler | null => {
  const normalized = normalizeRefreshKey(pathname);
  if (headerRefreshHandlers.has(normalized)) {
    return headerRefreshHandlers.get(normalized) || null;
  }

  let bestMatch: HeaderRefreshHandler | null = null;
  let bestLength = -1;
  headerRefreshHandlers.forEach((handler, key) => {
    if (key !== '/' && normalized.startsWith(`${key}/`) && key.length > bestLength) {
      bestMatch = handler;
      bestLength = key.length;
    }
  });
  return bestMatch;
};

export const triggerHeaderRefresh = async (pathname: string) => {
	const handler = resolveHeaderRefreshHandler(pathname);
	if (!handler) return;
	await handler();
};

export const useHeaderRefresh = (handler?: HeaderRefreshHandler | null) => {
	const location = useLocation();
	const refreshKey = normalizeRefreshKey(location.pathname);

	useEffect(() => {
		if (!handler) return;

		headerRefreshHandlers.set(refreshKey, handler);

		return () => {
			if (headerRefreshHandlers.get(refreshKey) === handler) {
				headerRefreshHandlers.delete(refreshKey);
			}
		};
	}, [handler, refreshKey]);
};
