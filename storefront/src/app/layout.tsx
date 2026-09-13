import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mistbox — Thoughtfully gathered, beautifully given',
  description:
    'Gift boxes gathered from Pacific Northwest makers. Inspired by nature. Made to connect.',
  openGraph: {
    title: 'Mistbox',
    description: 'Thoughtfully gathered. Beautifully given.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Jost:wght@300;400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
