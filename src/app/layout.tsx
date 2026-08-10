import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
 title: "Resume Intelligence",
 description: "Intelligent resume analysis professional paraphrasing and ATS optimization for modern professionals",
 keywords: ["resume", "ATS", "career", "job search", "resume enhancement"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
   <html lang="en" suppressHydrationWarning>
     <head />
     <body className={`${inter.className} bg-background text-foreground transition-colors duration-300 min-h-screen`}>
       <Script id="theme-script" strategy="beforeInteractive">
         {`
           (function() {
             try {
               var saved = localStorage.getItem('theme');
               var themes = ["light", "dark", "blue", "purple", "emerald", "rose", "sunset"];
               var theme = saved && themes.includes(saved) ? saved : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
               if (theme !== 'light') {
                 document.documentElement.classList.add(theme);
               }
             } catch (e) {}
           })();
         `}
       </Script>
       <Script id="security-script" strategy="afterInteractive">
         {`
           (function() {
             if (typeof window === 'undefined') return;

             // Disable right-click context menu site-wide
             document.addEventListener('contextmenu', function(e) {
               e.preventDefault();
             });

             // Disable developer tools and view-source shortcuts site-wide
             window.addEventListener('keydown', function(e) {
               var isCmdOrCtrl = e.ctrlKey || e.metaKey;
               var isShift = e.shiftKey;
               var isAlt = e.altKey;

               var isF12 = e.key === 'F12' || e.keyCode === 123;
               var isDevToolsShortcut = 
                 (isCmdOrCtrl && isShift && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.key === 'K' || e.key === 'k' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67 || e.keyCode === 75)) ||
                 (isCmdOrCtrl && isAlt && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) ||
                 (isCmdOrCtrl && (e.key === 'U' || e.key === 'u' || e.keyCode === 85)) ||
                 (isCmdOrCtrl && (e.key === 'S' || e.key === 's' || e.keyCode === 83));

               if (isF12 || isDevToolsShortcut) {
                 e.preventDefault();
                 e.stopPropagation();
               }
             }, true);
           })();
         `}
       </Script>
       <ThemeProvider>
         {children}
       </ThemeProvider>
     </body>
   </html>
 );
}
