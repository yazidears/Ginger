'use client';

import Link from 'next/link';
import {usePathname, useSearchParams} from 'next/navigation';
import {useEffect, useState} from 'react';

const CONTEXT_KEYS = ['scenario', 'sageRun', 'incident', 'minute', 'asset', 'lat', 'lon', 'room'];
const STORAGE_KEY = 'ginger-product-context-v1';

/** Product switches retain the selected evidence; they never start a model job. */
export default function ProductNav() {
  const path = usePathname();
  const search = useSearchParams();
  const [remembered, setRemembered] = useState('');
  const query = search.toString();
  useEffect(() => {
    const next = new URLSearchParams(query);
    const retained = new URLSearchParams();
    for (const key of CONTEXT_KEYS) {
      const value = next.get(key);
      if (value !== null) retained.set(key, value);
    }
    try {
      if (retained.size) {
        sessionStorage.setItem(STORAGE_KEY, retained.toString());
        setRemembered(retained.toString());
      } else {
        setRemembered(sessionStorage.getItem(STORAGE_KEY) || '');
      }
    } catch { setRemembered(retained.toString()); }
  }, [query]);
  const href = (destination: string) => `${destination}${remembered ? `?${remembered}` : ''}`;
  const active = path === '/ash-connect' ? 'ash-connect' : path.startsWith('/ash') ? 'ash' : ['/sage', '/demo', '/forest', '/satellite', '/replay'].includes(path) ? 'sage' : 'prevent';
  return <nav className="product-nav" aria-label="Products">
    <Link className="product-brand" href="/prevent" aria-label="GINGER"><span aria-hidden="true"/></Link>
    <div className="product-nav-links">
      {([['prevent', 'Prevent'], ['sage', 'Sage'], ['ash', 'Ash'], ['ash-connect', 'AshConnect']] as const).map(([id, label]) =>
        <Link key={id} href={href(`/${id}`)} aria-current={active === id ? 'page' : undefined}>{label}</Link>)}
    </div>
  </nav>;
}
