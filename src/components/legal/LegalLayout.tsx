import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

const PROFACE_URL = 'https://proface.kz'

interface Props {
  title: string
  updated: string
  sourceUrl: string
  children: ReactNode
}

/**
 * Shared dark-theme layout for legal pages (оферта, политика конфиденциальности).
 * Keeps the ProFace brand styling consistent with the landing page.
 */
export default function LegalLayout({ title, updated, sourceUrl, children }: Props) {
  return (
    <div className="bg-[#0D0A0B] text-white min-h-screen font-sans">
      {/* Top bar */}
      <header className="border-b border-white/[0.06] sticky top-0 z-40 bg-[#0D0A0B]/95 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="font-serif text-base font-semibold text-white/80">FABS</span>
            <span className="text-white/20 text-sm">×</span>
            <img src="/brand/proface-white.png" alt="ProFace" className="h-5 w-auto opacity-90" />
          </Link>
          <Link
            to="/"
            className="text-sm text-white/45 hover:text-white transition-colors"
          >
            ← На главную
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-12 sm:py-16">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-white mb-3 leading-tight">
          {title}
        </h1>
        <p className="text-white/30 text-xs mb-10">
          Редакция от {updated} ·{' '}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-400/70 hover:text-rose-300 transition-colors underline underline-offset-2"
          >
            Официальная версия на proface.kz
          </a>
        </p>

        <article className="legal-prose space-y-6 text-white/60 text-[15px] leading-relaxed">
          {children}
        </article>

        {/* Company footer */}
        <div className="mt-14 pt-8 border-t border-white/[0.06] text-sm text-white/40 space-y-1">
          <p className="text-white/70 font-semibold">ТОО «ProFace»</p>
          <p>Лицензия на медицинскую деятельность №20019614</p>
          <p>Алматы, пр. Абылай хана, 96 · Астана, пр. К. Мухамедханова, 4</p>
          <p>
            Тел.:{' '}
            <a href="tel:+77015557893" className="text-white/60 hover:text-white transition-colors">
              +7 (701) 555-78-93
            </a>{' '}
            · Email:{' '}
            <a href="mailto:support@proface.kz" className="text-white/60 hover:text-white transition-colors">
              support@proface.kz
            </a>
          </p>
          <p>
            <a
              href={PROFACE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-rose-400/70 hover:text-rose-300 transition-colors"
            >
              proface.kz
            </a>
          </p>
        </div>
      </main>
    </div>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-white font-semibold text-lg mb-2.5">{heading}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}
