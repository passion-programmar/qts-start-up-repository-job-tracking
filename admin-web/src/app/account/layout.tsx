import { PanelLayout } from '@/components/PanelLayout';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayout mode="account">{children}</PanelLayout>;
}
