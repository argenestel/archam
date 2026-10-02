import { useEffect, useState } from 'react';

export type Route =
  | { page: 'discover' }
  | { page: 'token'; address: `0x${string}`; buy?: string }
  | { page: 'create' }
  | { page: 'swap' }
  | { page: 'lend' }
  | { page: 'borrow' }
  | { page: 'leaders' }
  | { page: 'portfolio' }
  | { page: 'risks' }
  | { page: 'apps' }
  | { page: 'bridge' }
  | { page: 'profile'; address?: `0x${string}` };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const [, page = '', arg = ''] = path.split('/');
  if (page === 'token' && /^0x[0-9a-fA-F]{40}$/.test(arg)) {
    const buy = new URLSearchParams(query).get('buy') ?? undefined;
    return {
      page,
      address: arg as `0x${string}`,
      buy: buy && /^\d{1,9}(\.\d{1,6})?$/.test(buy) ? buy : undefined,
    };
  }
  if (page === 'profile')
    return { page, address: /^0x[0-9a-fA-F]{40}$/.test(arg) ? (arg as `0x${string}`) : undefined };
  if (['create', 'swap', 'lend', 'borrow', 'leaders', 'portfolio', 'risks', 'apps', 'bridge'].includes(page))
    return { page } as Route;
  return { page: 'discover' };
}
export const href = (route: Route) =>
  route.page === 'token'
    ? `#/token/${route.address}${route.buy ? `?buy=${route.buy}` : ''}`
    : route.page === 'profile'
      ? `#/profile${route.address ? `/${route.address}` : ''}`
      : route.page === 'discover'
        ? '#/'
        : `#/${route.page}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
