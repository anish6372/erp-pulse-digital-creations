import './globals.css';
import Overlays from '../components/Overlays';

export const metadata = { title: 'PDC ERP', icons: { icon: '/pdc-logo.png' } };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap" rel="stylesheet" />
      </head>
      <body className="app">
        {children}
        <Overlays />
      </body>
    </html>
  );
}
