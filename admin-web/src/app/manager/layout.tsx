import { PanelLayout } from '@/components/PanelLayout';

export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayout mode="manager">{children}</PanelLayout>;
}
