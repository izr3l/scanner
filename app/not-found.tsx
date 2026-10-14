import Link from 'next/link';
export default function NotFound() { return <main className="empty-route"><h1>Page not found.</h1><p>Your scanner workspace is one tap away.</p><Link href="/" className="button button-primary">Back to workspace</Link></main>; }
