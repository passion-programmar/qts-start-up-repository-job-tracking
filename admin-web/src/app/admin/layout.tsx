import { PanelLayout } from '@/components/PanelLayout';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayout mode="admin">{children}</PanelLayout>;
}
