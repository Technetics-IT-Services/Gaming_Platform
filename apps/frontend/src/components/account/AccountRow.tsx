'use client';

/**
 * AccountRow — a compact, large-touch mobile settings row (Phase 2C.10). Renders as a link or a button;
 * used across the account center, responsible gaming and support surfaces.
 */
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  href?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
  right?: React.ReactNode;
  testId?: string;
}

export function AccountRow({ icon: Icon, label, sublabel, href, onClick, tone = 'default', right, testId }: Props) {
  const color = tone === 'danger' ? '#b42318' : '#1b1f37';
  const body = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', minHeight: 56, background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 12, cursor: 'pointer' }}>
      <span style={{ display: 'inline-flex', width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9, background: '#ebeef5', border: '1px solid #ccd2e0' }}>
        <Icon size={17} color={color} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color }}>{label}</div>
        {sublabel && <div style={{ fontSize: 12, color: '#626a7e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sublabel}</div>}
      </div>
      {right ?? (href || onClick ? <ChevronRight size={18} color="#515970" /> : null)}
    </div>
  );
  if (href) return <Link href={href} data-testid={testId} style={{ textDecoration: 'none' }}>{body}</Link>;
  return <button type="button" data-testid={testId} onClick={onClick} style={{ width: '100%', padding: 0, border: 'none', background: 'transparent' }}>{body}</button>;
}

export default AccountRow;
