import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '「이미 있어」 운영 브리핑',
  description: '시스템·사용자·개발활동·트렌드 네 축을 읽어 주간 운영 브리핑 카드뉴스를 만든다',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
