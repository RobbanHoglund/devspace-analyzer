import { useState, type ReactNode } from 'react';
import { invoke, native } from './host';

export function DocumentationLink({ href, children }: { href: string; children: ReactNode }) {
  const [error, setError] = useState('');
  return <><a href={href} target="_blank" rel="noopener noreferrer" onClick={native ? e => {
    e.preventDefault(); setError('');
    void invoke('open_documentation', { url: href }).catch(() => setError('Could not open your browser. Copy the documentation link instead.'));
  } : undefined}>{children}</a>{error && <p role="alert">{error}</p>}</>;
}
