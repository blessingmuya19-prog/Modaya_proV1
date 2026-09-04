'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function EditorRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (id) {
      router.replace(`/studio/${id}`);
    }
  }, [id, router]);

  return (
    <div style={{ height: '100vh', background: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid #FFFFFF', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 13, color: '#737D8D' }}>Opening Studio…</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
