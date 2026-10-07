import { PanelLayout } from '@/components/PanelLayout';

export default function CallerLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayout mode="caller">{children}</PanelLayout>;
}
