import { PanelLayout } from '@/components/PanelLayout';

export default function BidderLayout({ children }: { children: React.ReactNode }) {
  return <PanelLayout mode="bidder">{children}</PanelLayout>;
}
