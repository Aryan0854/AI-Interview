import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "plyr/dist/plyr.css";
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
       <ThemeProvider>
         {children}
       </ThemeProvider>
     </body>
   </html>
 );
}
